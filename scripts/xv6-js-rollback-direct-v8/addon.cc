// Hosted diagnostic only. Built against the exact Node 20.20.2 headers.
// Copyright 2026 the Brickwright contributors. SPDX-License-Identifier: MIT
#include <node.h>
#include <v8.h>
#include <array>
#include <cstdio>
#include <cstdint>
#include <memory>

namespace {
constexpr unsigned kCohort = 64;
constexpr unsigned kMaxGc = 256;
constexpr unsigned kMaxNodes = 4096;
constexpr unsigned kMaxSamples = 65536;
using namespace v8;

struct State;
struct Slot {
  State* owner = nullptr;
  unsigned id = 0;
  Global<Object> handle;
  int gc = -1;
};
struct GcEvent { unsigned type = 0; unsigned flags = 0; bool ended = false; };
struct State {
  Isolate* isolate = nullptr;
  HeapProfiler* profiler = nullptr;
  bool begun = false;
  bool started = false;
  bool adopted = false;
  bool busy = false;
  bool poison = false;
  bool overflow = false;
  int active_gc = -1;
  unsigned gc_count = 0;
  std::array<GcEvent, kMaxGc> gc{};
  std::array<Slot, kCohort> slots{};
};

void Refuse(Isolate* isolate, const char* message) {
  isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, message).ToLocalChecked()));
}
State* Owner(const FunctionCallbackInfo<Value>& args, bool allow_failed = false) {
  auto* state = static_cast<State*>(Local<External>::Cast(args.Data())->Value());
  if (state->busy) { state->poison = true; Refuse(args.GetIsolate(), "reentry"); return nullptr; }
  if (!allow_failed && (state->poison || state->overflow)) {
    Refuse(args.GetIsolate(), "poison"); return nullptr;
  }
  state->busy = true;
  return state;
}
struct Busy { State* s; ~Busy() { s->busy = false; } };
void GcStart(Isolate*, GCType type, GCCallbackFlags flags, void* data) {
  auto* s = static_cast<State*>(data);
  if (s->active_gc != -1 || s->gc_count == kMaxGc) { s->overflow = true; return; }
  const unsigned i = s->gc_count++;
  s->gc[i] = {static_cast<unsigned>(type), static_cast<unsigned>(flags), false};
  s->active_gc = static_cast<int>(i);
}
void GcEnd(Isolate*, GCType type, GCCallbackFlags, void* data) {
  auto* s = static_cast<State*>(data);
  if (s->active_gc < 0 || s->gc[s->active_gc].type != static_cast<unsigned>(type)) {
    s->overflow = true; return;
  }
  s->gc[s->active_gc].ended = true;
  s->active_gc = -1;
}
void Weak(const WeakCallbackInfo<Slot>& info) {
  Slot* slot = info.GetParameter();
  slot->gc = slot->owner->active_gc;
  if (slot->gc < 0) slot->owner->overflow = true;
  slot->handle.Reset();
}
bool Put(Isolate* isolate, Local<Context> cx, Local<Object> o,
         const char* key, Local<Value> v) {
  auto k = String::NewFromUtf8(isolate, key).ToLocalChecked();
  return o->CreateDataProperty(cx, k, v).FromMaybe(false);
}
bool PutIndex(Local<Context> cx, Local<Array> a, uint32_t i, Local<Value> v) {
  return a->CreateDataProperty(cx, i, v).FromMaybe(false);
}
Local<Value> Num(Isolate* isolate, uint64_t n) {
  return Number::New(isolate, static_cast<double>(n));
}
void Begin(const FunctionCallbackInfo<Value>& args) {
  State* s = Owner(args); if (!s) return; Busy guard{s};
  if (s->begun || args.Length() != 1 || !args[0]->IsUint32()) {
    Refuse(s->isolate, "begin arguments"); return;
  }
  unsigned flags = args[0].As<Uint32>()->Value();
  if (flags != 0 && flags != 2 && flags != 4 && flags != 6) {
    Refuse(s->isolate, "flags"); return;
  }
  s->begun = true;
  s->profiler = s->isolate->GetHeapProfiler();
  s->isolate->AddGCPrologueCallback(GcStart, s);
  s->isolate->AddGCEpilogueCallback(GcEnd, s);
  if (!s->profiler->StartSamplingHeapProfiler(4096, 16,
      static_cast<HeapProfiler::SamplingFlags>(flags))) {
    s->isolate->RemoveGCPrologueCallback(GcStart, s);
    s->isolate->RemoveGCEpilogueCallback(GcEnd, s);
    Refuse(s->isolate, "sampler already active"); return;
  }
  s->started = true;
}
void Adopt(const FunctionCallbackInfo<Value>& args) {
  State* s = Owner(args); if (!s) return; Busy guard{s};
  if (!s->started || s->adopted || args.Length() != 1 ||
      !args[0]->IsArray() || args[0]->IsProxy()) {
    Refuse(s->isolate, "adopt arguments"); return;
  }
  Local<Array> array = args[0].As<Array>();
  if (array->Length() != kCohort) { Refuse(s->isolate, "cohort size"); return; }
  Local<Context> cx = s->isolate->GetCurrentContext();
  std::array<Local<Object>, kCohort> objects;
  for (unsigned i = 0; i < kCohort; ++i) {
    char index[12]; snprintf(index, sizeof(index), "%u", i);
    Local<Value> descriptor, v;
    Local<String> key = String::NewFromUtf8(s->isolate, index).ToLocalChecked();
    Local<String> valueKey = String::NewFromUtf8Literal(s->isolate, "value");
    if (!array->GetOwnPropertyDescriptor(cx, key).ToLocal(&descriptor) ||
        !descriptor->IsObject() ||
        !descriptor.As<Object>()->HasOwnProperty(cx, valueKey).FromMaybe(false) ||
        !descriptor.As<Object>()->Get(cx, valueKey).ToLocal(&v) ||
        !v->IsObject() || v->IsProxy() || s->poison) {
      s->poison = true; Refuse(s->isolate, "cohort member"); return;
    }
    objects[i] = v.As<Object>();
    for (unsigned j = 0; j < i; ++j) if (objects[i]->StrictEquals(objects[j])) {
      s->poison = true; Refuse(s->isolate, "duplicate target"); return;
    }
  }
  for (unsigned i = 0; i < kCohort; ++i) {
    s->slots[i].owner = s; s->slots[i].id = i;
    s->slots[i].handle.Reset(s->isolate, objects[i]);
    s->slots[i].handle.SetWeak(&s->slots[i], Weak, WeakCallbackType::kParameter);
  }
  s->adopted = true;
}
bool Tree(Isolate* isolate, Local<Context> cx, AllocationProfile::Node* node,
          Local<Array> out, unsigned* count, unsigned depth, uint32_t parent) {
  if (depth > 64 || *count == kMaxNodes) return false;
  Local<Object> item = Object::New(isolate);
  Local<String> name = node->name.IsEmpty() ?
      String::Empty(isolate) : node->name;
  Local<String> script = node->script_name.IsEmpty() ?
      String::Empty(isolate) : node->script_name;
  if (name->Length() > 256 || script->Length() > 1024) return false;
  if (!Put(isolate, cx, item, "id", Num(isolate, node->node_id)) ||
      !Put(isolate, cx, item, "parent", Num(isolate, parent)) ||
      !Put(isolate, cx, item, "depth", Num(isolate, depth)) ||
      !Put(isolate, cx, item, "name", name) ||
      !Put(isolate, cx, item, "script", script) ||
      !Put(isolate, cx, item, "line", Integer::New(isolate, node->line_number))) return false;
  if (!PutIndex(cx, out, (*count)++, item)) return false;
  for (auto* child : node->children)
    if (!Tree(isolate, cx, child, out, count, depth + 1, node->node_id)) return false;
  return true;
}
void Snapshot(const FunctionCallbackInfo<Value>& args) {
  State* s = Owner(args); if (!s) return; Busy guard{s};
  if (!s->started || args.Length() || s->active_gc != -1) {
    Refuse(s->isolate, "snapshot state"); return;
  }
  const unsigned before = s->gc_count;
  std::unique_ptr<AllocationProfile> p(s->profiler->GetAllocationProfile());
  if (!p || p->GetSamples().size() > kMaxSamples || s->overflow) {
    s->poison = true; Refuse(s->isolate, "profile bounds"); return;
  }
  Local<Context> cx = s->isolate->GetCurrentContext();
  Local<Object> result = Object::New(s->isolate);
  Local<Array> nodes = Array::New(s->isolate), samples = Array::New(s->isolate);
  unsigned count = 0;
  if (!Tree(s->isolate, cx, p->GetRootNode(), nodes, &count, 0, 0)) {
    s->poison = true; Refuse(s->isolate, "tree bounds"); return;
  }
  unsigned i = 0;
  for (const auto& x : p->GetSamples()) {
    if (x.size > 9007199254740991ULL) {
      s->poison = true; Refuse(s->isolate, "unsafe sample size"); return;
    }
    Local<Object> item = Object::New(s->isolate);
    char id[32]; snprintf(id, sizeof(id), "%llu", static_cast<unsigned long long>(x.sample_id));
    if (!Put(s->isolate, cx, item, "id", String::NewFromUtf8(s->isolate, id).ToLocalChecked()) ||
        !Put(s->isolate, cx, item, "node", Num(s->isolate, x.node_id)) ||
        !Put(s->isolate, cx, item, "size", Num(s->isolate, x.size)) ||
        !Put(s->isolate, cx, item, "count", Num(s->isolate, x.count)) ||
        !PutIndex(cx, samples, i++, item)) {
      s->poison = true; Refuse(s->isolate, "sample serialization"); return;
    }
  }
  if (s->poison || s->overflow || s->gc_count != before ||
      !Put(s->isolate, cx, result, "nodes", nodes) ||
      !Put(s->isolate, cx, result, "samples", samples)) {
    s->poison = true; Refuse(s->isolate, "snapshot mutation"); return;
  }
  args.GetReturnValue().Set(result);
}
void Facts(const FunctionCallbackInfo<Value>& args) {
  State* s = Owner(args, true); if (!s) return; Busy guard{s};
  if (args.Length()) { Refuse(s->isolate, "facts arguments"); return; }
  Local<Context> cx = s->isolate->GetCurrentContext();
  Local<Object> result = Object::New(s->isolate);
  Local<Array> gc = Array::New(s->isolate), weak = Array::New(s->isolate);
  const unsigned before = s->gc_count;
  for (unsigned i = 0; i < before; ++i) {
    Local<Object> e = Object::New(s->isolate);
    if (!Put(s->isolate, cx, e, "type", Num(s->isolate, s->gc[i].type)) ||
        !Put(s->isolate, cx, e, "flags", Num(s->isolate, s->gc[i].flags)) ||
        !Put(s->isolate, cx, e, "ended", Boolean::New(s->isolate, s->gc[i].ended)) ||
        !PutIndex(cx, gc, i, e)) {
      s->poison = true; Refuse(s->isolate, "facts write"); return;
    }
  }
  for (unsigned i = 0; i < kCohort; ++i)
    if (!PutIndex(cx, weak, i, Integer::New(s->isolate, s->slots[i].gc))) {
      s->poison = true; Refuse(s->isolate, "weak facts write"); return;
    }
  if (!Put(s->isolate, cx, result, "gc", gc) ||
      !Put(s->isolate, cx, result, "weak", weak) ||
      !Put(s->isolate, cx, result, "overflow", Boolean::New(s->isolate, s->overflow)) ||
      !Put(s->isolate, cx, result, "poison", Boolean::New(s->isolate, s->poison)) ||
      s->gc_count != before) {
    s->poison = true; Refuse(s->isolate, "facts GC window changed"); return;
  }
  args.GetReturnValue().Set(result);
}
void Stop(State* s) {
  if (s->started) {
    s->profiler->StopSamplingHeapProfiler();
    s->isolate->RemoveGCPrologueCallback(GcStart, s);
    s->isolate->RemoveGCEpilogueCallback(GcEnd, s);
    s->started = false;
  }
  for (auto& slot : s->slots) slot.handle.Reset();
}
void StopJs(const FunctionCallbackInfo<Value>& args) {
  State* s = Owner(args, true); if (!s) return; Busy guard{s};
  if (args.Length()) { Refuse(s->isolate, "stop arguments"); return; }
  Stop(s);
}
void Cleanup(void* data) { auto* s = static_cast<State*>(data); Stop(s); delete s; }
bool Export(Local<Object> exports, Local<Context> cx, State* s,
            const char* name, FunctionCallback fn) {
  Isolate* isolate = s->isolate;
  Local<Function> function;
  if (!Function::New(cx, fn, External::New(isolate, s)).ToLocal(&function))
    return false;
  return exports->CreateDataProperty(cx,
      String::NewFromUtf8(isolate, name).ToLocalChecked(), function).FromMaybe(false);
}
}  // namespace

NODE_MODULE_INIT() {
  (void)module;
  Isolate* isolate = context->GetIsolate();
  auto* state = new State(); state->isolate = isolate;
  node::AddEnvironmentCleanupHook(isolate, Cleanup, state);
  if (!Export(exports, context, state, "begin", Begin) ||
      !Export(exports, context, state, "adopt", Adopt) ||
      !Export(exports, context, state, "snapshot", Snapshot) ||
      !Export(exports, context, state, "facts", Facts) ||
      !Export(exports, context, state, "stop", StopJs)) return;
}
