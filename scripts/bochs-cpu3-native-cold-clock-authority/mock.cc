#define BW_CLOCK_MODEL_TESTING 1
#include "clock-authority.h"
#include <cassert>
#include <functional>
#include <iostream>
#include <string>

using namespace bw_cold_clock_model;
static std::array<uint8_t,ram_size> initial() {std::array<uint8_t,ram_size> a{};return a;}
static void denies(const std::function<void()>&f){bool denied=false;try{f();}catch(const std::runtime_error&){denied=true;}assert(denied);}
static void observe(Authority&a,Lease&l,const Copy&c,const std::function<void()>&effect=[]{}){
 a.reconcile(l,c,effect);
}
static void same_published(const Snapshot&a,const Snapshot&b){
 assert(a.published.n==b.published.n&&a.published.q==b.published.q&&
  a.published.debt==b.published.debt&&a.published.deadline==b.published.deadline);
 assert(a.acknowledged==b.acknowledged&&a.board==b.board&&a.board_generations==b.board_generations);
}
static void copied_preflight_and_valid_qn(){
 Authority a(initial());auto l=a.issue(Context{});
 a.append(l,{Word::quantum,Word::native_n}); // Valid complete [Q,N], invalid prefix Q>N.
 assert(a.inspect().logical.q==1&&a.inspect().published.q==0);
 a.stop(l,Stop::requested_return);Copy good=a.copied(l),bad=good;bad.tape[1]=Word::quantum;
 int effects=0;const Snapshot before=a.inspect();
 denies([&]{a.reconcile(l,bad,[&]{++effects;});});same_published(before,a.inspect());assert(effects==0);
 bad=good;bad.session++;denies([&]{observe(a,l,bad);});same_published(before,a.inspect());
 bad=good;bad.deadline++;denies([&]{observe(a,l,bad);});same_published(before,a.inspect());
 bad=good;bad.phase=Phase::paused;denies([&]{observe(a,l,bad);});same_published(before,a.inspect());
 bad=good;bad.epoch++;denies([&]{observe(a,l,bad);});same_published(before,a.inspect());
 bad=good;bad.irq_eligible=true;denies([&]{observe(a,l,bad);});same_published(before,a.inspect());
 denies([&]{a.reconcile(l,good,{});});same_published(before,a.inspect());
 a.reconcile(l,good,[&]{++effects;});assert(effects==1);
 auto s=a.inspect();assert(s.logical.n==1&&s.logical.q==1&&
  s.published.n==1&&s.published.q==1&&s.published.debt==6);
 denies([&]{observe(a,l,good);});a.close();
}
static void deadline_overshoot_and_rearm(){
 Authority a(initial());auto l=a.issue(Context{});
 std::vector<Word> words;for(int i=0;i<6;++i){words.push_back(Word::quantum);words.push_back(Word::native_n);}
 a.append(l,words);assert(a.inspect().logical.debt==36&&a.inspect().published.debt==0);
 denies([&]{a.append(l,{Word::quantum});});assert(a.inspect().logical.debt==36);
 a.stop(l,Stop::deadline);auto copy=a.copied(l);observe(a,l,copy);
 auto s=a.inspect();assert(s.device_ticket&&s.published.debt==36&&s.published.q==6);
 denies([&]{a.issue(Context{});});denies([&]{a.device_rearm(0);});
 a.device_rearm(32);denies([&]{a.device_rearm(32);});
 auto next=a.issue(Context{});a.append(next,{Word::native_n,Word::quantum});
 a.stop(next,Stop::requested_return);observe(a,next,a.copied(next));a.close();
}
static void journal_overlap_late_tamper_and_alias(){
 Authority a(initial());auto l=a.issue(Context{});
 auto w1=a.write(l,3,7),w2=a.write(l,3,9);
 assert(w1.status==WriteStatus::accepted&&w2.status==WriteStatus::accepted);
 auto pre=a.inspect();assert(pre.owned[3]==9&&pre.board[3]==0&&pre.source_alias_pending==2&&pre.journal_size==2);
 a.stop(l,Stop::requested_return);Copy good=a.copied(l),bad=good;
 bad.journal[1].before=42;denies([&]{observe(a,l,bad);});same_published(pre,a.inspect());
 bad=good;bad.journal[1].generation=9;denies([&]{observe(a,l,bad);});same_published(pre,a.inspect());
 bad=good;bad.journal[1].q++;denies([&]{observe(a,l,bad);});same_published(pre,a.inspect());
 observe(a,l,good);auto s=a.inspect();assert(s.board[3]==9&&s.board_generations[0]==2&&
  s.acknowledged==2&&s.source_alias_pending==2&&s.journal_size==0);
 assert(s.source_aliases.size()==2&&s.source_aliases[0].effect==1&&
  s.source_aliases[1].effect==2&&s.source_aliases[0].generation==1&&
  s.source_aliases[1].generation==2);
 auto alias=a.issue(Context{});a.stop(alias,Stop::requested_return);a.source_boundary(alias);
 assert(a.inspect().source_alias_pending==0);a.close();
}
static void full_journal_retry_once(){
 Authority a(initial());
 for(int group=0;group<2;++group){auto l=a.issue(Context{});
  for(int i=0;i<16;++i)assert(a.write(l,1,uint8_t(group*16+i+1)).status==WriteStatus::accepted);
  a.stop(l,Stop::requested_return);a.source_boundary(l);
 }
 auto l=a.issue(Context{});auto before=a.inspect();assert(before.journal_size==32&&before.source_alias_pending==0);
 auto full=a.write(l,1,33);assert(full.status==WriteStatus::pre_effect_retry&&full.effect==33);
 auto pending=a.inspect();assert(pending.owned[1]==32&&pending.committed==32&&pending.acknowledged==0&&pending.pending_retry);
 denies([&]{a.write(l,1,34);});denies([&]{a.retry(l,33,1,34);});
 Copy copy=a.copied(l);copy.journal.back().after=99;denies([&]{observe(a,l,copy);});same_published(pending,a.inspect());
 copy=a.copied(l);observe(a,l,copy);auto ack=a.inspect();assert(ack.acknowledged==32&&
  ack.source_alias_pending==0&&ack.pending_retry&&ack.board[1]==32&&ack.owned[1]==32);
 auto fresh=a.issue(Context{});auto accepted=a.retry(fresh,full.effect,1,33);
 assert(accepted.status==WriteStatus::accepted&&accepted.effect==33&&a.inspect().owned[1]==33);
 denies([&]{a.retry(fresh,full.effect,1,33);});
 a.stop(fresh,Stop::requested_return);observe(a,fresh,a.copied(fresh));
 auto after=a.inspect();assert(after.acknowledged==33&&after.source_alias_pending==1&&after.board[1]==33);
 auto alias=a.issue(Context{});a.stop(alias,Stop::requested_return);a.source_boundary(alias);a.close();
}
static void full_alias_capacity_retry(){
 Authority a(initial());auto l=a.issue(Context{});
 for(int i=1;i<=32;++i)assert(a.write(l,5,uint8_t(i)).status==WriteStatus::accepted);
 assert(a.inspect().source_alias_pending==32&&a.inspect().journal_size==32);
 const auto pending=a.write(l,5,33);assert(pending.status==WriteStatus::pre_effect_retry);
 observe(a,l,a.copied(l));auto ack=a.inspect();
 assert(ack.acknowledged==32&&ack.source_alias_pending==32&&ack.pending_retry&&ack.owned[5]==32);
 auto boundary=a.issue(Context{});a.stop(boundary,Stop::requested_return);a.source_boundary(boundary);
 assert(a.inspect().source_alias_pending==0&&a.inspect().pending_retry);
 auto retry_lease=a.issue(Context{});assert(a.retry(retry_lease,pending.effect,5,33).status==WriteStatus::accepted);
 a.stop(retry_lease,Stop::requested_return);observe(a,retry_lease,a.copied(retry_lease));
 auto last=a.issue(Context{});a.stop(last,Stop::requested_return);a.source_boundary(last);a.close();
}
static void alias_full_after_owner_ack_retry(){
 Authority a(initial());
 for(int group=0;group<2;++group){auto l=a.issue(Context{});
  for(int i=0;i<16;++i)assert(a.write(l,5,uint8_t(group*16+i+1)).status==WriteStatus::accepted);
  a.stop(l,Stop::requested_return);observe(a,l,a.copied(l));
 }
 auto l=a.issue(Context{});auto before=a.inspect();
 assert(before.acknowledged==32&&before.journal_size==0&&before.source_aliases.size()==32);
 for(size_t i=0;i<before.source_aliases.size();++i)
  assert(before.source_aliases[i].effect==i+1&&before.source_aliases[i].generation==i+1);
 auto deferred=a.write(l,5,33);auto stopped=a.inspect();
 assert(deferred.status==WriteStatus::pre_effect_retry&&deferred.effect==33&&
  stopped.owned[5]==32&&stopped.board[5]==32&&stopped.committed==32&&
  stopped.acknowledged==32&&stopped.source_alias_pending==32&&stopped.pending_retry);
 denies([&]{a.write(l,5,34);});denies([&]{a.retry(l,33,5,33);});
 a.source_boundary(l);auto cleared=a.inspect();
 assert(cleared.source_alias_pending==0&&cleared.pending_retry&&cleared.acknowledged==32);
 auto next=a.issue(Context{});denies([&]{a.retry(next,33,5,34);});
 assert(a.retry(next,33,5,33).status==WriteStatus::accepted);
 a.stop(next,Stop::requested_return);observe(a,next,a.copied(next));
 auto last=a.issue(Context{});a.stop(last,Stop::requested_return);a.source_boundary(last);a.close();
}
static void page_clock_and_actual_rom_ticket(){
 Authority a(initial());auto clock=a.issue(Context{});a.append(clock,{Word::native_n,Word::quantum});
 a.stop(clock,Stop::page_clock);Copy c=a.copied(clock);c.raw_page=0xf0;
 const Snapshot before=a.inspect();denies([&]{observe(a,clock,c);});same_published(before,a.inspect());
 c.raw_page=0;observe(a,clock,c);assert(!a.inspect().page_ticket);
 denies([&]{a.rom_page(0xf0);});
 auto page=a.issue(Context{});a.stop(page,Stop::rom_page);c=a.copied(page,0);
 const Snapshot no_page=a.inspect();denies([&]{observe(a,page,c);});same_published(no_page,a.inspect());
 c=a.copied(page,0xf0);observe(a,page,c);assert(a.inspect().page_ticket);
 denies([&]{a.issue(Context{});});denies([&]{a.rom_page(0xe0);});
 a.rom_page(0xf0);denies([&]{a.rom_page(0xf0);});a.close();
}
static void observer_failure_and_reentry(){
 {Authority a(initial());auto l=a.issue(Context{});a.write(l,2,5);a.stop(l,Stop::requested_return);
  Copy c=a.copied(l);denies([&]{observe(a,l,c,[]{throw std::runtime_error("first observer effect failed");});});
  assert(a.failed());denies([&]{a.issue(Context{});});}
 {Authority a(initial());auto l=a.issue(Context{});a.write(l,2,5);a.stop(l,Stop::requested_return);
  Copy c=a.copied(l);denies([&]{observe(a,l,c,[&]{try{(void)a.inspect();}catch(const std::runtime_error&){}});});
  assert(a.failed());denies([&]{a.issue(Context{});});}
}
static void stops_profile_and_capabilities(){
 for(Stop reason:{Stop::pio_in,Stop::pio_out,Stop::page_clock,Stop::irq_eligible,
  Stop::irq_delivery,Stop::halt,Stop::fault,Stop::code_write,Stop::mapping_change,
  Stop::a20_change,Stop::requested_return,Stop::paused_observer}){
  Authority a(initial());auto l=a.issue(Context{});a.stop(l,reason);
  denies([&]{a.append(l,{Word::native_n});});denies([&]{a.write(l,0,1);});
  const uint32_t port=reason==Stop::pio_in?0x60:reason==Stop::pio_out?0x64:0;
  const uint32_t width=port?1:0,value=reason==Stop::pio_out?0xaa:0;
  Copy good=a.copied(l,0,port,width,value),bad=good;bad.port=99;
  const Snapshot before=a.inspect();denies([&]{observe(a,l,bad);});same_published(before,a.inspect());
  observe(a,l,good);a.close();
 }
 for(Context bad:{Context{Phase::paused},Context{Phase::running,1},Context{Phase::running,0,0},
  Context{Phase::running,0,1,32,true},Context{Phase::running,0,1,32,false,true},
  Context{Phase::running,0,1,32,false,false,true},Context{Phase::running,0,1,32,false,false,false,true}}){
  Authority a(initial());denies([&]{a.issue(bad);});a.close();
 }
 Authority a(initial()),b(initial());auto la=a.issue(Context{});auto lb=b.issue(Context{});
 denies([&]{b.append(la,{Word::native_n});});
 auto moved=std::move(la);denies([&]{a.append(la,{Word::native_n});});
 a.stop(moved,Stop::requested_return);observe(a,moved,a.copied(moved));
 b.stop(lb,Stop::requested_return);observe(b,lb,b.copied(lb));a.close();b.close();
}
static void full_tape_abandon_and_overflow(){
 {Authority a(initial());auto l=a.issue(Context{});
  a.append(l,std::vector<Word>(tape_cap,Word::native_n));
  denies([&]{a.append(l,{Word::native_n});});a.stop(l,Stop::full_tape);
  observe(a,l,a.copied(l));assert(a.inspect().published.n==tape_cap);a.close();}
 {Authority a(initial());{auto l=a.issue(Context{});a.append(l,{Word::native_n});}
  assert(a.failed());denies([&]{a.issue(Context{});});}
 {Authority a(initial());a.control_next_lease(UINT64_MAX);denies([&]{a.issue(Context{});});
  a.control_next_lease(1);a.control_next_effect(UINT64_MAX);
  auto l=a.issue(Context{});denies([&]{a.write(l,0,1);});
  a.stop(l,Stop::requested_return);observe(a,l,a.copied(l));a.close();}
 Authority::control_session_counter(UINT64_MAX);
 denies([&]{Authority denied(initial());});
 Authority::control_session_counter(1000);
}
int main(){
 copied_preflight_and_valid_qn();deadline_overshoot_and_rearm();
 journal_overlap_late_tamper_and_alias();full_journal_retry_once();full_alias_capacity_retry();
 alias_full_after_owner_ack_retry();
 page_clock_and_actual_rom_ticket();observer_failure_and_reentry();
 stops_profile_and_capabilities();full_tape_abandon_and_overflow();
 std::cout<<"cold clock-authority SOURCE_ONLY_UNCONNECTED controls PASS (10 groups)\n";
}
