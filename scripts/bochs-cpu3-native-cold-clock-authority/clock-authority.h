// Pure cold CPU3 clock-authority model. SOURCE_ONLY_UNCONNECTED; no Bochs hook.
#ifndef BW_CPU3_COLD_CLOCK_AUTHORITY_MODEL_H
#define BW_CPU3_COLD_CLOCK_AUTHORITY_MODEL_H
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace bw_cold_clock_model {
constexpr uint32_t ram_size=256,page_size=16,tape_cap=16,journal_cap=32;
enum class Word:uint8_t {native_n=1,quantum=2,rep_quantum=3};
enum class Phase:uint8_t {running=1,paused=2};
enum class Stop:uint8_t {deadline,full_journal,full_tape,pio_in,pio_out,page_clock,rom_page,
 irq_eligible,irq_delivery,halt,fault,code_write,mapping_change,a20_change,
 requested_return,paused_observer};
enum class WriteStatus:uint8_t {accepted,pre_effect_retry};
struct Clock {uint64_t n=0,q=0;uint32_t debt=0,deadline=32;};
struct Context {Phase phase=Phase::running;uint32_t epoch=0,a20=1,deadline=32;
 bool irq_eligible=false,memory_observing_device=false,dma=false,mmio=false;};
struct Entry {uint64_t session=0,sequence=0,effect=0,n=0,q=0;uint32_t address=0,generation=0;
 uint8_t before=0,after=0;};
struct Alias {uint64_t effect=0,n=0,q=0;uint32_t address=0,generation=0;};
struct Copy {uint64_t session=0,lease=0,acknowledged=0;Phase phase=Phase::running;
 Stop reason=Stop::requested_return;uint32_t epoch=0,a20=1,deadline=32,raw_page=0,
 port=0,width=0,value=0;bool irq_eligible=false;
 Clock published{},logical{};std::vector<Word> tape;std::vector<Entry> journal;};
struct Snapshot {Clock logical{},published{};uint64_t acknowledged=0,committed=0,next_effect=1;
 uint32_t source_alias_pending=0;size_t journal_size=0,tape_size=0;
 bool active=false,failed=false,closed=false,page_ticket=false,device_ticket=false,
 pending_retry=false,profile_revoked=false;
 std::vector<Alias> source_aliases;
 std::array<uint8_t,ram_size> owned{},board{};
 std::array<uint32_t,ram_size/page_size> source_generations{},board_generations{};};
struct WriteResult {WriteStatus status;uint64_t effect=0,sequence=0;};

inline void require(bool good,const char *why){if(!good)throw std::runtime_error(why);}
struct State {
 const uint64_t session;
 Clock logical{},published{};
 std::array<uint8_t,ram_size> owned{},board{};
 std::array<uint32_t,ram_size/page_size> source_gen{},board_gen{};
 std::vector<Word> tape;std::vector<Entry> journal;std::vector<Alias> source_aliases;
 uint64_t next_lease=1,active_lease=0,next_effect=1,committed=0,acknowledged=0;
 bool busy=false,failed=false,closed=false;
 bool profile_revoked=false;
 bool page_ticket=false,device_ticket=false;uint32_t page_raw=0;
 struct Pending {uint64_t effect;uint32_t address;uint8_t before,after;};
 bool retry_pending=false;Pending retry{};
 Context context{};Stop stopped=Stop::requested_return;bool has_stop=false;
 explicit State(uint64_t id,const std::array<uint8_t,ram_size>&initial):session(id),owned(initial),board(initial){
  tape.reserve(tape_cap);journal.reserve(journal_cap);source_aliases.reserve(journal_cap);
 }
};

class Authority;
class Lease {
 friend class Authority;
 std::weak_ptr<State> state_;uint64_t session_=0,serial_=0;bool active_=false;
 Lease(const std::shared_ptr<State>&s,uint64_t serial):state_(s),session_(s->session),serial_(serial),active_(true){}
public:
 Lease(const Lease&)=delete;Lease&operator=(const Lease&)=delete;Lease&operator=(Lease&&)=delete;
 Lease(Lease&&other)noexcept:state_(std::move(other.state_)),session_(other.session_),serial_(other.serial_),active_(other.active_){other.active_=false;}
 ~Lease(){if(active_)if(auto s=state_.lock())s->failed=true;}
};

class Authority {
 inline static std::atomic<uint64_t> ids_{0};
 std::shared_ptr<State> s_;
 static uint64_t issue_id(){uint64_t old=ids_.load(std::memory_order_relaxed);
  for(;;){require(old<UINT64_MAX,"session identity capacity");
   if(ids_.compare_exchange_weak(old,old+1,std::memory_order_relaxed))return old+1;}}
 static bool valid_rom_page(uint32_t raw){return raw==0xf0;}
 static bool valid_stop(Stop why){switch(why){
  case Stop::deadline:case Stop::full_journal:case Stop::full_tape:
  case Stop::pio_in:case Stop::pio_out:case Stop::page_clock:case Stop::rom_page:
  case Stop::irq_eligible:case Stop::irq_delivery:case Stop::halt:case Stop::fault:
  case Stop::code_write:case Stop::mapping_change:case Stop::a20_change:
  case Stop::requested_return:case Stop::paused_observer:return true;
  }return false;}
 static bool outside_profile(Stop why){switch(why){
  case Stop::irq_eligible:case Stop::irq_delivery:case Stop::halt:case Stop::fault:
  case Stop::code_write:case Stop::mapping_change:case Stop::a20_change:return true;
  default:return false;}}
 void gate()const{if(s_->busy){s_->failed=true;throw std::runtime_error("observer reentry");}
  require(!s_->failed&&!s_->closed,"terminal clock authority");}
 void lease(Lease&l,bool allow_stopped=false)const{
  gate();require(l.active_&&l.session_==s_->session&&l.serial_==s_->active_lease&&
   l.state_.lock().get()==s_.get(),"issued session/lease capability");
  require(allow_stopped||!s_->has_stop,"revoked lease");
 }
 void consume(Lease&l){l.active_=false;s_->active_lease=0;s_->has_stop=false;}
 static bool same(const Entry&a,const Entry&b){return a.session==b.session&&a.sequence==b.sequence&&
  a.effect==b.effect&&a.n==b.n&&a.q==b.q&&a.address==b.address&&
  a.generation==b.generation&&a.before==b.before&&a.after==b.after;}
 void preflight(const Copy&c)const{
  require(valid_stop(c.reason)&&c.session==s_->session&&c.lease==s_->active_lease&&c.phase==s_->context.phase&&
   c.reason==s_->stopped&&c.epoch==s_->context.epoch&&c.a20==s_->context.a20&&
   c.deadline==s_->context.deadline&&c.irq_eligible==s_->context.irq_eligible,
   "copied lease/session/phase/map/A20/IRQ/deadline");
  require(c.acknowledged==s_->acknowledged&&c.published.n==s_->published.n&&
   c.published.q==s_->published.q&&c.published.debt==s_->published.debt&&
   c.published.deadline==s_->published.deadline&&c.logical.n==s_->logical.n&&
   c.logical.q==s_->logical.q&&c.logical.debt==s_->logical.debt&&
   c.logical.deadline==s_->logical.deadline,"copied independent N/Q/debt ledgers");
  require(c.tape==s_->tape&&c.tape.size()<=tape_cap&&c.journal.size()==s_->journal.size()&&
   c.journal.size()<=journal_cap,"copied tape/journal extent");
  for(size_t i=0;i<c.journal.size();++i)require(same(c.journal[i],s_->journal[i]),"copied journal exact entry");
  if(c.reason==Stop::rom_page)require(valid_rom_page(c.raw_page)&&c.port==0&&c.width==0&&c.value==0,"actual ROM page");
  else require(c.raw_page==0,"unexpected ROM page argument");
  if(c.reason==Stop::pio_in)require(c.port==0x60&&c.width==1&&c.value==0,"IN8 argument");
  else if(c.reason==Stop::pio_out)require(c.port==0x64&&c.width==1&&c.value==0xaa,"OUT8 argument");
  else require(c.port==0&&c.width==0&&c.value==0,"unexpected scalar argument");
  if(c.reason==Stop::deadline)require(s_->logical.debt>=s_->logical.deadline,"actual due cut");
  if(c.reason==Stop::full_journal)require(s_->journal.size()==journal_cap,"actual full journal");
  if(c.reason==Stop::full_tape)require(s_->tape.size()==tape_cap,"actual full tape");
  require(!s_->context.memory_observing_device&&!s_->context.dma&&!s_->context.mmio&&
   !s_->context.irq_eligible,"accounting-only observer profile");
  // The complete tape is checked against the JS-published ledger before any
  // board mutation. Q may temporarily precede N but Q<=N on completion.
  Clock projected=s_->published;
  for(Word w:c.tape){require(w==Word::native_n||w==Word::quantum||w==Word::rep_quantum,"tape word");
   if(w==Word::native_n){require(projected.n<400000&&
    (projected.debt<projected.deadline||projected.n<projected.q),
    "N bound/due completion");++projected.n;}
   else{require(projected.q<400000&&projected.debt<projected.deadline,"Q due/bound");
    ++projected.q;projected.debt+=6;}
  }
  require(projected.q<=projected.n&&projected.n==s_->logical.n&&
   projected.q==s_->logical.q&&projected.debt==s_->logical.debt,"complete source/board clock projection");
  auto staged_bytes=s_->board;auto staged_gen=s_->board_gen;
  require(c.journal.empty()||c.journal.front().effect>0,"first journal effect");
  uint64_t sequence=s_->acknowledged,effect=c.journal.empty()?0:c.journal.front().effect-1;
  uint64_t previous_n=0,previous_q=0;
  for(const Entry&e:c.journal){
   require(e.session==s_->session&&e.sequence==++sequence&&e.effect==++effect&&
    e.address<ram_size&&e.q<=e.n&&e.n>=previous_n&&e.q>=previous_q&&
    e.n<=s_->logical.n&&e.q<=s_->logical.q,
    "journal session/sequence/effect/NQ/span");
   previous_n=e.n;previous_q=e.q;
   const uint32_t page=e.address/page_size;
   require(staged_bytes[e.address]==e.before&&staged_gen[page]<UINT32_MAX&&
    e.generation==staged_gen[page]+1,"journal before/overlay/generation");
   staged_bytes[e.address]=e.after;++staged_gen[page];
  }
  for(const Entry&e:c.journal)require(staged_bytes[e.address]==s_->owned[e.address],"owner final byte projection");
 }
public:
 explicit Authority(const std::array<uint8_t,ram_size>&initial):s_(std::make_shared<State>(issue_id(),initial)){}
 Authority(const Authority&)=delete;Authority&operator=(const Authority&)=delete;
 Lease issue(const Context&context){gate();require(!s_->profile_revoked&&!s_->active_lease&&!s_->page_ticket&&!s_->device_ticket&&
   s_->logical.debt<s_->logical.deadline,"one lease and no unresolved device/page cut");
  require(context.phase==Phase::running&&context.epoch==0&&context.a20==1&&
   !context.irq_eligible&&!context.memory_observing_device&&!context.dma&&!context.mmio&&
   context.deadline>=1&&context.deadline<=6000&&context.deadline==s_->logical.deadline,
   "fixed accounting-only clock authority");
  require(s_->next_lease!=UINT64_MAX,"lease serial capacity");
  s_->context=context;s_->active_lease=s_->next_lease++;return Lease(s_,s_->active_lease);}
 void append(Lease&l,const std::vector<Word>&words){lease(l);require(!s_->retry_pending,"pending write retry blocks clocks");
  require(!words.empty()&&s_->tape.size()+words.size()<=tape_cap,"bounded tape before clock effect");
  Clock next=s_->logical;
  for(Word w:words){require(w==Word::native_n||w==Word::quantum||w==Word::rep_quantum,"source word");
   if(w==Word::native_n){require(next.n<400000&&
    (next.debt<next.deadline||next.n<next.q),"source N capacity/due completion");++next.n;}
   else{require(next.q<400000&&next.debt<next.deadline,"source Q before due");++next.q;next.debt+=6;}}
  const size_t deficit=next.q>next.n?size_t(next.q-next.n):0;
  require(s_->tape.size()+words.size()+deficit<=tape_cap,
   "reserve tape slots for unfinished Q/N boundary");
  s_->tape.insert(s_->tape.end(),words.begin(),words.end());s_->logical=next;}
 WriteResult write(Lease&l,uint32_t address,uint8_t after){lease(l);require(!s_->retry_pending,"exact pending write only");
  require(s_->logical.q<=s_->logical.n&&address<ram_size&&
   s_->logical.debt<s_->logical.deadline&&s_->tape.size()<tape_cap,
   "completed source clock/address/boundary cut");
  require(s_->next_effect!=UINT64_MAX&&s_->committed!=UINT64_MAX,"effect/sequence capacity");
  if(s_->journal.size()==journal_cap){s_->retry_pending=true;
   s_->retry={s_->next_effect,address,s_->owned[address],after};s_->stopped=Stop::full_journal;s_->has_stop=true;
   return {WriteStatus::pre_effect_retry,s_->next_effect,s_->committed};}
  if(s_->source_aliases.size()==journal_cap){s_->retry_pending=true;
   s_->retry={s_->next_effect,address,s_->owned[address],after};
   s_->stopped=Stop::requested_return;s_->has_stop=true;
   return {WriteStatus::pre_effect_retry,s_->next_effect,s_->committed};}
  const uint32_t page=address/page_size;require(s_->source_gen[page]!=UINT32_MAX,"source generation capacity");
  Entry e{s_->session,s_->committed+1,s_->next_effect,s_->logical.n,s_->logical.q,address,
          s_->source_gen[page]+1,s_->owned[address],after};
  s_->journal.push_back(e);s_->source_aliases.push_back({e.effect,e.n,e.q,address,e.generation});
  s_->owned[address]=after;++s_->source_gen[page];++s_->committed;++s_->next_effect;
  return {WriteStatus::accepted,e.effect,e.sequence};}
 WriteResult retry(Lease&l,uint64_t effect,uint32_t address,uint8_t after){lease(l);
  require(s_->retry_pending&&effect==s_->retry.effect&&address==s_->retry.address&&
   after==s_->retry.after&&s_->owned[address]==s_->retry.before,"identical uncommitted retry");
  require(s_->journal.size()<journal_cap&&s_->source_aliases.size()<journal_cap&&
   s_->logical.q<=s_->logical.n&&s_->logical.debt<s_->logical.deadline&&
   s_->tape.size()<tape_cap&&s_->next_effect!=UINT64_MAX&&s_->committed!=UINT64_MAX&&
   s_->source_gen[address/page_size]!=UINT32_MAX,"retry pre-effect capacities and cut");
  s_->retry_pending=false;return write(l,address,after);}
 void source_boundary(Lease&l){lease(l,true);require(s_->has_stop&&
  (s_->stopped==Stop::requested_return||s_->stopped==Stop::paused_observer)&&
  s_->logical.q<=s_->logical.n&&s_->logical.debt<s_->logical.deadline,
  "authenticated completed source boundary before device due");
  // Source CPU alias publication is independent of owner journal ACK.
  s_->source_aliases.clear();consume(l);}
 void stop(Lease&l,Stop why){lease(l);require(valid_stop(why)&&s_->logical.q<=s_->logical.n,
  "admitted completed boundary Q<=N");
  if(why==Stop::deadline)require(s_->logical.debt>=s_->logical.deadline,"not due");
  if(why==Stop::full_journal)require(s_->journal.size()==journal_cap,"not full journal");
  if(why==Stop::full_tape)require(s_->tape.size()==tape_cap,"not full tape");
  s_->stopped=why;s_->has_stop=true;}
 Copy copied(Lease&l,uint32_t raw_page=0,uint32_t port=0,uint32_t width=0,uint32_t value=0)const{
  lease(l,true);require(s_->has_stop,"only stopped observer");
  return {s_->session,s_->active_lease,s_->acknowledged,s_->context.phase,s_->stopped,
   s_->context.epoch,s_->context.a20,s_->context.deadline,raw_page,port,width,value,
   s_->context.irq_eligible,s_->published,s_->logical,s_->tape,s_->journal};}
 void reconcile(Lease&l,const Copy&copy,const std::function<void()>&observer){
  lease(l,true);require(s_->has_stop&&bool(observer),"stopped observer required");preflight(copy);
  // No callback sits between complete validation and this bounded commit.
  for(const Entry&e:copy.journal){s_->board[e.address]=e.after;++s_->board_gen[e.address/page_size];}
  s_->acknowledged+=copy.journal.size();s_->journal.clear();s_->published=s_->logical;s_->tape.clear();
  if(copy.reason==Stop::rom_page){s_->page_ticket=true;s_->page_raw=copy.raw_page;}
  if(s_->logical.debt>=s_->logical.deadline)s_->device_ticket=true;
  if(outside_profile(copy.reason))s_->profile_revoked=true;
  consume(l);s_->busy=true;
  try{if(observer)observer();}catch(...){s_->failed=true;s_->busy=false;throw;}
  s_->busy=false;require(!s_->failed,"observer reentry failstop");}
 void rom_page(uint32_t raw){gate();require(!s_->active_lease&&s_->page_ticket&&s_->page_raw==raw&&
  valid_rom_page(raw),"one-use admitted ROM page ticket");s_->page_ticket=false;}
 void device_rearm(uint32_t next_deadline){gate();require(!s_->active_lease&&s_->device_ticket&&
  next_deadline>=1&&next_deadline<=6000,"one-use actual device rearm");
  s_->device_ticket=false;s_->logical.debt=s_->published.debt=0;
  s_->logical.deadline=s_->published.deadline=next_deadline;}
 Snapshot inspect()const{gate();return {s_->logical,s_->published,s_->acknowledged,s_->committed,
  s_->next_effect,uint32_t(s_->source_aliases.size()),s_->journal.size(),s_->tape.size(),
  s_->active_lease!=0,s_->failed,s_->closed,s_->page_ticket,s_->device_ticket,s_->retry_pending,
  s_->profile_revoked,
  s_->source_aliases,s_->owned,s_->board,s_->source_gen,s_->board_gen};}
 bool failed()const{return s_->failed;}
 void close(){gate();require(!s_->active_lease&&!s_->page_ticket&&
  !s_->device_ticket&&!s_->retry_pending&&
  s_->journal.empty()&&s_->tape.empty()&&s_->source_aliases.empty(),"closed no pending extent");s_->closed=true;}
#ifdef BW_CLOCK_MODEL_TESTING
 void control_next_lease(uint64_t value){gate();require(!s_->active_lease,"test lease seed at rest");s_->next_lease=value;}
 void control_next_effect(uint64_t value){gate();require(!s_->active_lease,"test effect seed at rest");s_->next_effect=value;}
 void control_source_generation(uint32_t page,uint32_t value){gate();
  require(!s_->active_lease&&page<s_->source_gen.size(),"test generation seed at rest");
  s_->source_gen[page]=value;}
 static void control_session_counter(uint64_t value){ids_.store(value,std::memory_order_relaxed);}
#endif
};
} // namespace bw_cold_clock_model
#endif
