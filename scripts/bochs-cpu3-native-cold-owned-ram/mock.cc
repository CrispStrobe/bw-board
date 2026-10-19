// Standalone interface tests: no Bochs, Node addon, real JS shadow or guest.
#define BW_COLD_OWNED_RAM_TEST 1
#include "owned-ram.h"
#include <cassert>
#include <iostream>
#include <type_traits>
#include <new>
using namespace bw_cold_owned_ram;
namespace bw_cold_owned_ram {struct ShadowTestAccess {static void corrupt(Shadow& s,uint32_t address,uint8_t value){s.bytes_.at(address)=value;}};}
static std::vector<uint8_t> ram(){return std::vector<uint8_t>(ram_extent,0);}
static std::vector<uint8_t> rom(){std::vector<uint8_t> out(rom_extent);for(unsigned i=0;i<out.size();++i)out[i]=uint8_t(i);return out;}
template<class F> static void denial(F f,const char*word){bool rejected=false;try{f();}catch(const std::runtime_error&e){rejected=std::string(e.what()).find(word)!=std::string::npos;}assert(rejected);}
static void copy_decode(){
 auto input=ram(),firmware=rom();input[0x2000]=31;Session s(input,firmware);auto shadow=s.make_shadow();input[0x2000]=99;firmware[7]=99;
 for(unsigned i=0;i<ram_extent;++i)assert(s.inspect_byte(i)==shadow.diagnostic_byte(i));
 assert(s.read(0x2000,1)[0]==31&&s.read(0xf0007,1)[0]==7&&s.read(0xffff0007,1)[0]==7&&s.read(0xc0000,1)[0]==0xff);
 auto ignored=s.write(0xffff0007,{4},1,1,1);assert(!ignored.committed&&!ignored.retry_same_effect&&s.read(0xf0007,1)[0]==7&&s.journal_size()==0);
 auto open=s.write(0xc0000,{3},2,2,2);assert(!open.committed&&s.read(0xc0000,1)[0]==0xff);
 denial([&]{shadow.observer_byte(0);},"observer admission");s.before_observer(shadow,[&](const Shadow&view){assert(view.observer_byte(0x2000)==31);});s.close(shadow);assert(s.closed()&&!s.failed());
}
static void admission_denials(){
 for(unsigned which=0;which<6;++which){Session s(ram(),rom());auto shadow=s.make_shadow();(void)shadow;
  switch(which){case 0:denial([&]{s.write(0,{1},1,1,2);},"Q<=N");break;case 1:denial([&]{s.write(0xa0000,{1},1,1,1);},"MMIO");break;case 2:denial([&]{s.write(4095,{1,2},1,1,1);},"raw span");break;case 3:denial([&]{s.write(UINT32_MAX,{1,2},1,1,1);},"raw span");break;case 4:denial([&]{s.write(0,std::vector<uint8_t>(17),1,1,1);},"byte length");break;case 5:denial([&]{s.write(0x9ffff,{1,2},1,1,1);},"raw span");break;}
  assert(s.failed()&&s.committed_sequence()==0&&s.inspect_byte(0)==0);
 }
}
static void reserve_retry(){
 Session s(ram(),rom());auto shadow=s.make_shadow();
 for(uint64_t i=1;i<=journal_capacity;++i){auto result=s.write(uint32_t(i-1)*16,std::vector<uint8_t>(16,uint8_t(i)),i,i,i);assert(result.committed);}
 auto blocked=s.write(0x2000,{73,74},33,33,33);assert(blocked.fence==Fence::pre_effect_journal_full&&!blocked.committed&&blocked.retry_same_effect);
 assert(s.inspect_byte(0x2000)==0&&s.committed_sequence()==32&&s.next_effect()==33&&s.fence_state().uncommitted_retry);
 auto first=s.drain(),again=s.drain();assert(first.entries.size()==32&&again.entries.size()==32&&first.acknowledged==0&&s.acknowledged()==0);
 first.entries[0].after[0]=99;assert(again.entries[0].after[0]==1&&s.inspect_byte(0)==1); // Drain copy owns its evidence.
 s.reconcile_and_ack(again,shadow);assert(shadow.acknowledged()==32&&s.acknowledged()==32&&s.journal_size()==0&&s.fence_state().uncommitted_retry);
 auto retry=s.write(0x2000,{73,74},33,33,33);assert(retry.committed&&!retry.retry_same_effect&&s.inspect_byte(0x2000)==73&&s.next_effect()==34&&!s.fence_state().uncommitted_retry);
 s.before_observer(shadow,[&](const Shadow&view){assert(view.observer_byte(0x2000)==73);});s.close(shadow);
}
static void changed_retry(){
 Session s(ram(),rom());auto shadow=s.make_shadow();for(uint64_t i=1;i<=32;++i)s.write(uint32_t(i),{1},i,i,i);
 s.write(0x3000,{7,8},33,33,33);auto batch=s.drain();s.reconcile_and_ack(batch,shadow);
 denial([&]{s.write(0x3000,{7,9},33,33,33);},"retry bytes");assert(s.inspect_byte(0x3000)==0&&s.committed_sequence()==32&&s.next_effect()==33);
}
static void atomic_batch_and_overlap(){
 {Session s(ram(),rom());auto shadow=s.make_shadow();s.write(0x100,{1,2},1,1,1);s.write(0x101,{3,4},2,2,2);auto batch=s.drain();batch.entries[1].after[0]=99;
  denial([&]{s.reconcile_and_ack(batch,shadow);},"exact copied journal");assert(shadow.diagnostic_byte(0x100)==0&&shadow.diagnostic_byte(0x101)==0&&shadow.acknowledged()==0&&s.acknowledged()==0&&s.journal_size()==2);}
 {Session s(ram(),rom());auto shadow=s.make_shadow();s.write(0x100,{1,2},1,1,1);s.write(0x101,{3,4},2,2,2);auto batch=s.drain();s.reconcile_and_ack(batch,shadow);
  assert(shadow.diagnostic_byte(0x100)==1&&shadow.diagnostic_byte(0x101)==3&&shadow.diagnostic_byte(0x102)==4&&shadow.acknowledged()==2);
  denial([&]{s.reconcile_and_ack(batch,shadow);},"watermark");assert(shadow.diagnostic_byte(0x101)==3&&shadow.acknowledged()==2);}
 {Session s(ram(),rom());auto shadow=s.make_shadow();s.write(0x100,{1},1,1,1);s.write(0x200,{2},2,2,2);
  ShadowTestAccess::corrupt(shadow,0x200,9);auto batch=s.drain();
  denial([&]{s.reconcile_and_ack(batch,shadow);},"before-byte");
  assert(shadow.diagnostic_byte(0x100)==0&&shadow.diagnostic_byte(0x200)==9&&shadow.acknowledged()==0&&s.journal_size()==2);
 }
}
static void unique_shadow(){
 static_assert(!std::is_constructible<Shadow,const std::vector<uint8_t>&>::value,"no caller-forged shadow");static_assert(!std::is_copy_constructible<Shadow>::value,"no copied shadow brand");static_assert(!std::is_copy_constructible<Session>::value,"no forked session identity");
 auto other_input=ram();other_input[0x5000]=99;Session a(ram(),rom()),b(other_input,rom());auto shadow_a=a.make_shadow();auto shadow_b=b.make_shadow();
 assert(shadow_a.diagnostic_byte(0x5000)==0&&shadow_b.diagnostic_byte(0x5000)==99);a.write(0,{1},1,1,1);bool called=false;
 denial([&]{a.before_observer(shadow_b,[&](const Shadow&){called=true;});},"owner/session");assert(!called&&shadow_b.diagnostic_byte(0)==0&&shadow_b.diagnostic_byte(0x5000)==99&&a.acknowledged()==0);
 {Session s(ram(),rom());auto shadow=s.make_shadow();(void)shadow;denial([&]{s.make_shadow();},"one full initial");assert(s.committed_sequence()==0);}
 {
  alignas(Session) unsigned char storage[sizeof(Session)];
  Session *first=new(storage) Session(ram(),rom());auto old=first->make_shadow();first->~Session();
  Session *second=new(storage) Session(ram(),rom());auto current=second->make_shadow();
  assert(first==second);bool called=false;
  denial([&]{second->before_observer(old,[&](const Shadow&){called=true;});},"owner/session");
  assert(!called&&old.diagnostic_byte(0)==0&&current.diagnostic_byte(0)==0);
  second->~Session();
 }
}
static void observer_errors(){
 {Session s(ram(),rom());auto shadow=s.make_shadow();s.write(4,{8},1,1,1);s.before_observer(shadow,[&](const Shadow&view){assert(view.observer_byte(4)==8&&s.acknowledged()==1);});denial([&]{shadow.observer_byte(4);},"observer admission");s.close(shadow);}
 {Session s(ram(),rom());auto shadow=s.make_shadow();s.write(4,{8},1,1,1);bool primary=false;try{s.before_observer(shadow,[](const Shadow&){throw std::logic_error("original observer failure");});}catch(const std::logic_error&e){primary=std::string(e.what())=="original observer failure";}assert(primary&&s.failed()&&s.acknowledged()==1&&shadow.diagnostic_byte(4)==8);denial([&]{shadow.observer_byte(4);},"observer admission");}
 {Session s(ram(),rom());auto shadow=s.make_shadow();s.write(4,{8},1,1,1);denial([&]{s.before_observer(shadow,[&](const Shadow&){try{s.write(5,{9},2,2,2);}catch(const std::runtime_error&){};});},"forbidden reentry");assert(s.failed()&&s.inspect_byte(5)==0&&s.committed_sequence()==1);}
 {Session s(ram(),rom());auto shadow=s.make_shadow();(void)shadow;bool foreign_refused=false;std::thread foreign([&]{try{s.read(0,1);}catch(const std::runtime_error&e){foreign_refused=std::string(e.what())=="owned RAM owner thread";}});foreign.join();assert(foreign_refused&&!s.failed());}
}
static void code_and_effect_ordinals(){
 Session s(ram(),rom());auto shadow=s.make_shadow();auto page=s.execute_page(0x1000);page[0]=77;assert(s.inspect_byte(0x1000)==0);
 auto committed=s.write(0x1000,{7},1,1,1);assert(committed.fence==Fence::post_effect_code_write&&committed.committed&&!committed.retry_same_effect&&s.fence_state().committed_code_write&&!s.execution_ready());
 s.acknowledge_code_invalidation(1,1);assert(s.execution_ready());s.before_observer(shadow,[&](const Shadow&view){assert(view.observer_byte(0x1000)==7);});
 // A committed effect is never retried, even after drain/ack.
 denial([&]{s.write(0x1000,{7},1,1,1);},"once-only effect");assert(s.committed_sequence()==1&&s.inspect_byte(0x1000)==7);
 {Session c(ram(),rom());auto view=c.make_shadow();(void)view;c.execute_page(0x1000);c.write(0x1000,{8},1,1,1);denial([&]{c.acknowledge_code_invalidation(1,2);},"exact committed code generation");assert(c.inspect_byte(0x1000)==8&&c.code_pending());}
}
int main(){copy_decode();std::cout<<"PASS copied RAM/ROM decode and admitted observers\n";admission_denials();std::cout<<"PASS whole-span/MMIO/Q>N refusal before effects\n";reserve_retry();std::cout<<"PASS atomic journal reservation copied drain and exact retry\n";changed_retry();std::cout<<"PASS changed pending payload refusal\n";atomic_batch_and_overlap();std::cout<<"PASS tampered batch atomic refusal overlap and duplicate ack\n";unique_shadow();std::cout<<"PASS full initial ownership and unique shadow association\n";observer_errors();std::cout<<"PASS observer reconciliation reentry exception and thread denial\n";code_and_effect_ordinals();std::cout<<"PASS committed code fence invalidation and once-only effect\n";}
