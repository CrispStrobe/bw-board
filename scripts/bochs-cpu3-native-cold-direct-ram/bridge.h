// Same-DSO cold CPU3 RAM bridge model. CPU3/N-API wiring is a later gate.
#ifndef BW_CPU3_COLD_DIRECT_RAM_BRIDGE_H
#define BW_CPU3_COLD_DIRECT_RAM_BRIDGE_H
#include "abi.h"
#include "../bochs-cpu3-native-cold-owned-ram/owned-ram.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <functional>
#include <optional>
#include <stdexcept>
#include <thread>
#include <vector>

namespace bw_cold_direct_ram {
using Core = bw_cold_owned_ram::Session;
using Kind = bw_cold_owned_ram::Kind;
using Entry = bw_cold_owned_ram::Entry;
using Batch = bw_cold_owned_ram::Batch;
using Fence = bw_cold_owned_ram::Fence;

// The eventual N-API wrapper must construct this afresh from napi_get_typedarray_info
// on each synchronous call, after strict object/buffer identity and backing checks.
// No raw pointer is retained by Bridge between calls.
struct BoardView {
 uint64_t session_identity;
 const void *ram_object,*ram_buffer,*generation_object,*generation_buffer;
 uint8_t *bytes;size_t byte_extent;
 uint32_t *generations;size_t generation_count;
 bool ordinary,detached,shared;
};
struct MemoryRequest {
 uint32_t raw,length;const uint8_t *operand;bool write;
 bw_cold_direct_ram_source_ledger source;
};
struct BoundaryRequest {
 uint32_t kind,phase;
 const uint32_t *tape;uint32_t tape_count;
 uint64_t n_before,q_before,n_after,q_after;
 uint32_t debt_before,deadline;
 uint32_t page_raw,port,width,value;
 uint32_t mapping_epoch,board_a20;
};
struct Prepared {
 uint64_t session_identity,ticket;
 uint32_t kind,phase,page_raw,port,width,value,mapping_epoch,board_a20;
 uint64_t n_before,q_before,n_after,q_after;
 uint32_t debt_before,deadline;
 std::vector<uint32_t> tape;
 Batch batch;
};
struct CommitReceipt {uint64_t acknowledged,n,q;uint32_t entries;};

class Bridge {
 inline static std::atomic<uint64_t> issued_{0};
 static uint64_t issue(){uint64_t old=issued_.load(std::memory_order_relaxed);for(;;){if(old==UINT64_MAX)throw std::overflow_error("direct RAM identity overflow");if(issued_.compare_exchange_weak(old,old+1,std::memory_order_relaxed))return old+1;}}
 const uint64_t id_=issue();
 Core session_;
 bw_cold_owned_ram::Shadow shadow_;
 std::thread::id owner_=std::this_thread::get_id();
 const void *ram_object_=nullptr,*ram_buffer_=nullptr,*generation_object_=nullptr,*generation_buffer_=nullptr;
 std::optional<Prepared> prepared_;
 std::optional<uint32_t> page_ticket_;
 uint64_t ticket_=0,n_=0,q_=0;
 bool bound_=false,busy_=false,closed_=false;
 mutable bool failed_=false;
 static void require(bool good,const char *why){if(!good)throw std::runtime_error(why);}
 void read_gate()const{require(std::this_thread::get_id()==owner_,"direct RAM owner thread");if(busy_){failed_=true;throw std::runtime_error("direct RAM observer reentry");}}
 void gate()const{read_gate();
  require(bound_&&!failed_&&!closed_,"direct RAM phase/lifetime");}
 static bool entry_equal(const Entry&a,const Entry&b){return a.sequence==b.sequence&&a.effect==b.effect&&a.n==b.n&&a.q==b.q&&a.epoch==b.epoch&&a.address==b.address&&a.length==b.length&&a.generation==b.generation&&a.before==b.before&&a.after==b.after;}
 static bool batch_equal(const Batch&a,const Batch&b){
  if(a.epoch!=b.epoch||a.acknowledged!=b.acknowledged||a.through!=b.through||a.entries.size()!=b.entries.size())return false;
  for(size_t i=0;i<a.entries.size();++i)if(!entry_equal(a.entries[i],b.entries[i]))return false;
  return true;
 }
 static bool prepared_equal(const Prepared&a,const Prepared&b){
  return a.session_identity==b.session_identity&&a.ticket==b.ticket&&a.kind==b.kind&&a.phase==b.phase&&a.page_raw==b.page_raw&&
   a.port==b.port&&a.width==b.width&&a.value==b.value&&a.mapping_epoch==b.mapping_epoch&&a.board_a20==b.board_a20&&
   a.n_before==b.n_before&&a.q_before==b.q_before&&a.n_after==b.n_after&&a.q_after==b.q_after&&a.debt_before==b.debt_before&&
   a.deadline==b.deadline&&a.tape==b.tape&&batch_equal(a.batch,b.batch);
 }
 static Kind span(uint32_t raw,uint32_t length,uint32_t &decoded){
  require(length&&length<=16&&uint64_t(raw)+length<=uint64_t(UINT32_MAX)+1&&(raw&4095)+length<=4096,"direct RAM raw span");
  decoded=Core::decode(raw);const Kind kind=Core::classify(decoded);
  require(kind!=Kind::mmio&&uint64_t(decoded)+length<=uint64_t(UINT32_MAX)+1&&(decoded&4095)+length<=4096,"direct RAM MMIO/decoded span");
  for(uint32_t i=0;i<length;++i)require(Core::decode(raw+i)==decoded+i&&Core::classify(decoded+i)==kind,"direct RAM whole span");
  return kind;
 }
 static bool rom_page(uint32_t raw){
  if(raw&4095)return false;
  const uint32_t decoded=Core::decode(raw);
  if(Core::classify(decoded)!=Kind::rom)return false;
  for(uint32_t i=0;i<4096;++i)if(Core::decode(raw+i)!=decoded+i||Core::classify(decoded+i)!=Kind::rom)return false;
  return true;
 }
 static bool out_allowed(uint32_t port,uint32_t value){
  if(value>255)return false;
  switch(port){
   case 0x0d:case 0xda:case 0xd4:case 0x71:case 0x40:case 0x80:return value==0;
   case 0xd6:return value==0xc0;
   case 0x70:return value==0x0f;
   case 0x43:return value==0x34;
   case 0x402:return true;
   case 0x64:return value==0xaa||value==0xab;
   default:return false;
  }
 }
 void view(const BoardView&v)const{
  require(bound_&&v.session_identity==id_&&v.ram_object==ram_object_&&v.ram_buffer==ram_buffer_&&
   v.generation_object==generation_object_&&v.generation_buffer==generation_buffer_,"direct RAM board object/buffer/session");
  require(v.ordinary&&!v.detached&&!v.shared&&v.bytes&&v.generations&&v.byte_extent==BW_COLD_DIRECT_RAM_BOARD_BYTES&&
   v.generation_count==BW_COLD_DIRECT_RAM_RAM_BYTES/4096,"direct RAM board backing/span");
 }
 void preflight(const BoundaryRequest&r)const{
  require(r.mapping_epoch==0&&r.board_a20==1,"direct RAM fixed mapping");
  require(r.tape_count<=900&&(!r.tape_count||r.tape),"direct RAM copied tape extent");
  require(r.n_before==n_&&r.q_before==q_&&r.n_before<=400000&&r.q_before<=r.n_before,"direct RAM starting N/Q");
  require(r.deadline>=1&&r.deadline<=6000&&r.debt_before<=r.deadline+5,"direct RAM clock debt/deadline");
  if(r.kind==BW_COLD_DIRECT_RAM_PAUSED_OBSERVER){
   require(r.phase==BW_COLD_DIRECT_RAM_PAUSED&&r.tape_count==0,"direct RAM paused observer phase");
  }else{
   require(r.phase==BW_COLD_DIRECT_RAM_RUNNING,"direct RAM running observer phase");
   require(r.kind>=BW_COLD_DIRECT_RAM_MEMORY&&r.kind<=BW_COLD_DIRECT_RAM_PIO_OUT,"direct RAM reason/PIC ACK");
  }
  uint64_t n=r.n_before,q=r.q_before;uint32_t debt=r.debt_before;
  for(uint32_t i=0;i<r.tape_count;++i){
   const uint32_t word=r.tape[i];require(word>=1&&word<=3,"direct RAM tape word");
   if(word==1){require(n<400000,"direct RAM N cap");++n;}
   else{require(q<400000&&debt<r.deadline,"direct RAM Q due/cap");++q;debt+=6;}
  }
  require(n==r.n_after&&q==r.q_after&&q<=n,"direct RAM completed tape N/Q");
  if(r.kind==BW_COLD_DIRECT_RAM_PAGE){require(rom_page(r.page_raw),"direct RAM ROM-only whole page");}
  else require(r.page_raw==0,"direct RAM unexpected page argument");
  if(r.kind==BW_COLD_DIRECT_RAM_PIO_IN)require(r.width==1&&r.value==0&&
   (r.port==0x71||r.port==0x64||r.port==0x60),"direct RAM IN8 admission");
  else if(r.kind==BW_COLD_DIRECT_RAM_PIO_OUT)require(r.width==1&&out_allowed(r.port,r.value),"direct RAM OUT8 admission");
  else require(r.port==0&&r.width==0&&r.value==0,"direct RAM unexpected scalar argument");
 }
 static void validate_board(const BoardView&v,const Batch&b){
  require(b.entries.size()<=BW_COLD_DIRECT_RAM_JOURNAL_CAPACITY,"direct RAM journal capacity");
  for(size_t i=0;i<b.entries.size();++i){const Entry&e=b.entries[i];
   require(e.length&&e.length<=16&&e.address<bw_cold_owned_ram::ram_extent&&e.address+e.length<=bw_cold_owned_ram::ram_extent&&
    (e.address&4095)+e.length<=4096,"direct RAM journal span");
   const uint32_t page=e.address/4096;uint64_t expected=v.generations[page];
   for(size_t k=0;k<i;++k)if(b.entries[k].address/4096==page)++expected;
   require(expected<UINT32_MAX&&e.generation==expected+1,"direct RAM board generation");
   for(uint32_t j=0;j<e.length;++j){const uint32_t address=e.address+j;uint8_t want=v.bytes[address];
    for(size_t k=0;k<i;++k){const Entry&p=b.entries[k];if(address>=p.address&&address<p.address+p.length)want=p.after[address-p.address];}
    require(want==e.before[j],"direct RAM board before byte");
   }
  }
 }
public:
 Bridge(const std::vector<uint8_t>&ram,const std::vector<uint8_t>&rom):session_(ram,rom),shadow_(session_.make_shadow()){}
 Bridge(const Bridge&)=delete;Bridge&operator=(const Bridge&)=delete;
 uint64_t session_identity()const{read_gate();return id_;}
 void bind_initial_view(const BoardView&v){
  require(std::this_thread::get_id()==owner_&&!bound_&&!failed_&&!closed_,"direct RAM one initial board binding");
  require(v.session_identity==id_&&v.ram_object&&v.ram_buffer&&v.generation_object&&v.generation_buffer&&
   v.ram_object!=v.generation_object&&v.ram_buffer!=v.generation_buffer&&v.ordinary&&!v.detached&&!v.shared&&
   v.bytes&&v.generations&&v.byte_extent==BW_COLD_DIRECT_RAM_BOARD_BYTES&&
   v.generation_count==BW_COLD_DIRECT_RAM_RAM_BYTES/4096,"direct RAM initial board identity/span");
  for(uint32_t i=0;i<bw_cold_owned_ram::ram_extent;++i)require(v.bytes[i]==session_.inspect_byte(i),"direct RAM initial copied board byte");
  for(uint32_t i=0;i<v.generation_count;++i)require(v.generations[i]==0,"direct RAM initial board generation");
  ram_object_=v.ram_object;ram_buffer_=v.ram_buffer;generation_object_=v.generation_object;generation_buffer_=v.generation_buffer;bound_=true;
 }
 bw_cold_direct_ram_memory_reply memory(const MemoryRequest&r){
  gate();require(!prepared_&&!page_ticket_,"direct RAM prepared observer/page pending");
  require(r.source.mapping_epoch==0&&r.source.board_a20==1&&r.source.n==n_&&r.source.q==q_&&q_<=n_&&
   r.source.pending_writes<=BW_COLD_DIRECT_RAM_JOURNAL_CAPACITY&&
   r.source.owner_committed_sequence==session_.committed_sequence()&&
   r.source.owner_acknowledged_sequence==session_.acknowledged(),"direct RAM trusted source/owner ledger");
  uint32_t decoded=0;const Kind kind=span(r.raw,r.length,decoded);
  const uint32_t before=kind==Kind::ram?session_.generation_at(decoded):0;
  require(r.source.generation_before==before,"direct RAM source generation before effect");
  require((r.write&&r.operand&&r.source.effect==session_.next_effect())||(!r.write&&!r.operand&&r.source.effect==0),"direct RAM source effect/operand");
  bw_cold_direct_ram_memory_reply out{};out.status=BW_COLD_DIRECT_RAM_ACCEPTED;out.decoded=decoded;out.kind=uint32_t(kind);
  out.effect_kind=r.write?(kind==Kind::ram?1:kind==Kind::rom?2:3):0;
  out.mapping_epoch=0;out.board_a20=1;out.effect=r.source.effect;out.n=n_;out.q=q_;
  if(r.write){
   const auto result=session_.write(r.raw,std::vector<uint8_t>(r.operand,r.operand+r.length),r.source.effect,n_,q_);
   out.sequence=result.sequence;out.generation=kind==Kind::ram?session_.generation_at(decoded):0;
   if(result.fence==Fence::pre_effect_journal_full){out.status=BW_COLD_DIRECT_RAM_PRE_EFFECT_RETRY;return out;}
   if(result.fence==Fence::post_effect_code_write)out.status=BW_COLD_DIRECT_RAM_POST_EFFECT_CODE_FENCE;
   if(kind==Kind::ram)memcpy(out.observed,r.operand,r.length);
   else{const auto observed=session_.read(r.raw,r.length);memcpy(out.observed,observed.data(),r.length);}
  }else{
   const auto observed=session_.read(r.raw,r.length);memcpy(out.observed,observed.data(),r.length);
   out.sequence=session_.committed_sequence();out.generation=before;
  }
  return out;
 }
 std::array<uint8_t,4096> rom_execute_page(uint32_t raw){gate();require(!prepared_&&page_ticket_&&*page_ticket_==raw&&
  session_.journal_size()==0&&rom_page(raw),"direct RAM admitted reconciled ROM-only execute page");
  auto page=session_.execute_page(raw);page_ticket_.reset();return page;}
 Prepared prepare(const BoundaryRequest&r){
  gate();require(!prepared_&&!page_ticket_,"direct RAM one prepared observer/page");
  // Copy the caller's tape before validating it; never validate one view and
  // then drain against a different caller-mutated view.
  Prepared p{};if(r.tape_count){require(r.tape&&r.tape_count<=900,"direct RAM tape pointer/cap");p.tape.assign(r.tape,r.tape+r.tape_count);}
  BoundaryRequest admitted=r;admitted.tape=p.tape.empty()?nullptr:p.tape.data();preflight(admitted); // NO drain/ack/board effect before full admission.
  p.session_identity=id_;p.ticket=++ticket_;p.kind=r.kind;p.phase=r.phase;p.page_raw=r.page_raw;
  p.port=r.port;p.width=r.width;p.value=r.value;p.mapping_epoch=r.mapping_epoch;p.board_a20=r.board_a20;
  p.n_before=r.n_before;p.q_before=r.q_before;p.n_after=r.n_after;p.q_after=r.q_after;p.debt_before=r.debt_before;p.deadline=r.deadline;
  p.batch=session_.drain();prepared_=p;return p;
 }
 CommitReceipt commit(const Prepared&p,const BoardView&v,const std::function<void(const CommitReceipt&)>&observer={}){
  gate();require(prepared_&&prepared_equal(p,*prepared_)&&p.session_identity==id_,"direct RAM exact prepared session/batch");
  view(v);const Batch current=session_.drain();require(batch_equal(p.batch,current),"direct RAM unchanged copied journal");
  validate_board(v,p.batch); // Full board-byte/generation validation before either shadow mutates.
  busy_=true;bool internal_commit_started=false;
  try{
   internal_commit_started=true;session_.reconcile_and_ack(p.batch,shadow_);
   // No allocation, JS call or reentry between native acknowledgement and the
   // already-validated borrowed board writes. The N-API transaction is not yet built.
   for(const Entry&e:p.batch.entries){memcpy(v.bytes+e.address,e.after.data(),e.length);v.generations[e.address/4096]=e.generation;}
   n_=p.n_after;q_=p.q_after;prepared_.reset();
   const CommitReceipt receipt{session_.acknowledged(),n_,q_,uint32_t(p.batch.entries.size())};
   if(observer)observer(receipt);
   require(!failed_,"direct RAM observer attempted reentry");
   if(p.kind==BW_COLD_DIRECT_RAM_PAGE)page_ticket_=p.page_raw;
   busy_=false;return receipt;
  }catch(...){busy_=false;if(internal_commit_started)failed_=true;throw;}
 }
 void close(){gate();require(!prepared_&&!page_ticket_&&session_.journal_size()==0&&!session_.fence_state().uncommitted_retry&&
  !session_.fence_state().committed_code_write,"direct RAM close pending effect");session_.close(shadow_);closed_=true;}
 uint64_t acknowledged()const{read_gate();return session_.acknowledged();}
 uint64_t committed()const{read_gate();return session_.committed_sequence();}
 uint64_t next_effect()const{read_gate();return session_.next_effect();}
 unsigned journal_size()const{read_gate();return session_.journal_size();}
 uint32_t generation_at(uint32_t address)const{read_gate();return session_.generation_at(address);}
 uint8_t owned_byte(uint32_t address)const{read_gate();return session_.inspect_byte(address);}
 bool failed()const{read_gate();return failed_||session_.failed();}
};
}
#endif
