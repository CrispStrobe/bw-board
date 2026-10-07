#include "bridge.h"
#include <cassert>
#include <iostream>
#include <thread>

using namespace bw_cold_direct_ram;

template<class F> static void denies(F&&f){bool rejected=false;try{f();}catch(const std::exception&){rejected=true;}assert(rejected);}

struct Fixture {
 std::vector<uint8_t> ram=std::vector<uint8_t>(BW_COLD_DIRECT_RAM_RAM_BYTES,0);
 std::vector<uint8_t> rom=std::vector<uint8_t>(BW_COLD_DIRECT_RAM_ROM_BYTES,0x42);
 std::vector<uint8_t> board=std::vector<uint8_t>(BW_COLD_DIRECT_RAM_BOARD_BYTES,0);
 std::vector<uint32_t> generations=std::vector<uint32_t>(BW_COLD_DIRECT_RAM_RAM_BYTES/4096,0);
 int ram_object=1,ram_buffer=2,gen_object=3,gen_buffer=4;
 Bridge bridge{ram,rom};
 BoardView view(){return {bridge.session_identity(),&ram_object,&ram_buffer,&gen_object,&gen_buffer,
  board.data(),board.size(),generations.data(),generations.size(),true,false,false};}
 Fixture(){bridge.bind_initial_view(view());}
 MemoryRequest write(uint32_t address,uint8_t &byte,uint32_t source_pending=0){
  return {address,1,&byte,true,{0,0,bridge.next_effect(),bridge.committed(),bridge.acknowledged(),
   bridge.generation_at(address),source_pending,0,1}};
 }
 MemoryRequest read(uint32_t address,uint32_t length){
  return {address,length,nullptr,false,{0,0,0,bridge.committed(),bridge.acknowledged(),
   address<BW_COLD_DIRECT_RAM_RAM_BYTES?bridge.generation_at(address):0,0,0,1}};
 }
 BoundaryRequest boundary(uint32_t kind=BW_COLD_DIRECT_RAM_MEMORY){
  BoundaryRequest r{};r.kind=kind;r.phase=kind==BW_COLD_DIRECT_RAM_PAUSED_OBSERVER?BW_COLD_DIRECT_RAM_PAUSED:BW_COLD_DIRECT_RAM_RUNNING;
  r.deadline=100;r.mapping_epoch=0;r.board_a20=1;return r;
 }
};

static void copied_identity_and_decode(){
 Fixture f;
 f.ram[0]=0xa5;f.rom[0]=0xc3; // Construction copied both extents.
 assert(f.bridge.owned_byte(0)==0);
 assert(f.bridge.memory(f.read(0xf0000,1)).observed[0]==0x42);
 assert(f.bridge.memory(f.read(0xffff0000,1)).observed[0]==0x42);
 assert(f.bridge.memory(f.read(0x200000,1)).observed[0]==0xff);
 denies([&]{f.bridge.memory(f.read(0xa0000,1));});
 denies([&]{f.bridge.rom_execute_page(0xf0000);}); // No page callback admission.
 denies([&]{f.bridge.rom_execute_page(0x7000);});
 auto page=f.boundary(BW_COLD_DIRECT_RAM_PAGE);page.page_raw=0x7000;
 denies([&]{f.bridge.prepare(page);});
 page.page_raw=0xf0000;auto admitted=f.bridge.prepare(page);f.bridge.commit(admitted,f.view());
 uint8_t blocked_byte=0x7c;auto blocked_write=f.write(0x100,blocked_byte);auto blocked_read=f.read(0x100,1);
 denies([&]{f.bridge.memory(blocked_write);});denies([&]{f.bridge.memory(blocked_read);});
 denies([&]{f.bridge.prepare(f.boundary());});denies([&]{f.bridge.close();});
 assert(f.bridge.owned_byte(0x100)==0&&f.board[0x100]==0&&f.generations[0]==0&&
  f.bridge.journal_size()==0&&f.bridge.acknowledged()==0&&f.bridge.committed()==0&&f.bridge.next_effect()==1);
 assert(f.bridge.rom_execute_page(0xf0000)[0]==0x42);
 denies([&]{f.bridge.rom_execute_page(0xf0000);}); // Single-use page ticket.
 page.page_raw=0xffff0000;admitted=f.bridge.prepare(page);f.bridge.commit(admitted,f.view());
 assert(f.bridge.rom_execute_page(0xffff0000)[0]==0x42);
 Fixture other;
 auto prepared=f.bridge.prepare(f.boundary());
 auto wrong=other.view();denies([&]{f.bridge.commit(prepared,wrong);});
 auto good=f.view();good.ram_object=&other.ram_object;denies([&]{f.bridge.commit(prepared,good);});
 f.bridge.commit(prepared,f.view());
}

static void preflight_before_ack_and_effect(){
 Fixture f;uint8_t byte=0x5a;
 auto wr=f.write(0x100,byte);auto accepted=f.bridge.memory(wr);assert(accepted.status==BW_COLD_DIRECT_RAM_ACCEPTED);
 assert(f.bridge.owned_byte(0x100)==0x5a&&f.board[0x100]==0&&f.bridge.acknowledged()==0);
 denies([&]{f.bridge.rom_execute_page(0xf0000);});
 assert(f.bridge.journal_size()==1&&f.bridge.acknowledged()==0&&f.board[0x100]==0);
 uint32_t tape[]={2,1};auto valid=f.boundary();valid.tape=tape;valid.tape_count=2;valid.n_after=1;valid.q_after=1;
 auto check_bad=[&](BoundaryRequest bad){denies([&]{f.bridge.prepare(bad);});
  assert(f.bridge.acknowledged()==0&&f.board[0x100]==0&&f.generations[0]==0&&f.bridge.journal_size()==1);};
 auto bad=valid;bad.kind=BW_COLD_DIRECT_RAM_PIC_ACK_FORBIDDEN;check_bad(bad);
 bad=valid;bad.phase=BW_COLD_DIRECT_RAM_PAUSED;check_bad(bad);
 bad=valid;bad.tape_count=1;check_bad(bad);
 uint32_t bad_word[]={4};bad=valid;bad.tape=bad_word;bad.tape_count=1;check_bad(bad);
 bad=valid;bad.n_after=0;check_bad(bad);
 bad=valid;bad.kind=BW_COLD_DIRECT_RAM_PAGE;bad.page_raw=0x7000;check_bad(bad);
 bad=valid;bad.kind=BW_COLD_DIRECT_RAM_PIO_OUT;bad.port=0x20;bad.width=1;check_bad(bad);
 bad=valid;bad.kind=BW_COLD_DIRECT_RAM_PIO_IN;bad.port=0x60;bad.width=2;check_bad(bad);
 bad=valid;bad.board_a20=0;check_bad(bad);
 auto p=f.bridge.prepare(valid);auto tampered=p;tampered.batch.entries[0].before[0]=0xff;
 denies([&]{f.bridge.commit(tampered,f.view());});assert(f.board[0x100]==0&&f.bridge.acknowledged()==0);
 auto alternate=f.view();alternate.detached=true;denies([&]{f.bridge.commit(p,alternate);});
 alternate=f.view();alternate.shared=true;denies([&]{f.bridge.commit(p,alternate);});
 alternate=f.view();alternate.byte_extent--;denies([&]{f.bridge.commit(p,alternate);});
 f.board[0x100]=1;denies([&]{f.bridge.commit(p,f.view());});f.board[0x100]=0;
 tape[0]=3; // Prepared retained the validated copied tape.
 auto receipt=f.bridge.commit(p,f.view());assert(receipt.acknowledged==1&&receipt.n==1&&receipt.q==1);
 assert(f.board[0x100]==0x5a&&f.generations[0]==1&&f.bridge.journal_size()==0);
 denies([&]{f.bridge.commit(p,f.view());});
}

static void page_clock_flush_is_not_page_admission(){
 Fixture f;uint8_t byte=0x5a;
 assert(f.bridge.memory(f.write(0x100,byte)).status==BW_COLD_DIRECT_RAM_ACCEPTED);
 uint32_t tape[]={1,2};auto clock=f.boundary(BW_COLD_DIRECT_RAM_PAGE_CLOCK);
 clock.tape=tape;clock.tape_count=2;clock.n_after=1;clock.q_after=1;
 auto malformed=clock;malformed.tape_count=0;
 denies([&]{f.bridge.prepare(malformed);});
 malformed=clock;malformed.page_raw=0xf0000;
 denies([&]{f.bridge.prepare(malformed);});
 assert(f.bridge.acknowledged()==0&&f.board[0x100]==0&&f.bridge.journal_size()==1);
 auto prepared=f.bridge.prepare(clock);auto receipt=f.bridge.commit(prepared,f.view());
 assert(receipt.acknowledged==1&&receipt.n==1&&receipt.q==1&&f.board[0x100]==byte);
 assert(!f.bridge.page_ticket());
 denies([&]{f.bridge.rom_execute_page(0xf0000);}); // Clock flush never grants a page ticket.
 auto page=f.boundary(BW_COLD_DIRECT_RAM_PAGE);page.n_before=page.n_after=1;
 page.q_before=page.q_after=1;page.debt_before=6;page.page_raw=0;
 denies([&]{f.bridge.prepare(page);});
 page.page_raw=0x7000;
 denies([&]{f.bridge.prepare(page);}); // Actual callback remains ROM-only.
 assert(!f.bridge.page_ticket()&&f.bridge.acknowledged()==1);
 page.page_raw=0xf0000;prepared=f.bridge.prepare(page);f.bridge.commit(prepared,f.view());
 assert(f.bridge.page_ticket());assert(f.bridge.rom_execute_page(0xf0000)[0]==0x42);
 assert(!f.bridge.page_ticket());f.bridge.close();
}

static void capacity_retry_and_distinct_ledgers(){
 Fixture f;
 for(unsigned i=0;i<32;++i){uint8_t byte=uint8_t(i+1);auto req=f.write(0x200+i,byte,0);
  const auto result=f.bridge.memory(req);assert(result.status==BW_COLD_DIRECT_RAM_ACCEPTED&&result.sequence==i+1);}
 assert(f.bridge.journal_size()==32&&f.bridge.committed()==32&&f.bridge.acknowledged()==0);
 uint8_t byte=0x77;auto retry=f.write(0x300,byte,0);auto result=f.bridge.memory(retry);
 assert(result.status==BW_COLD_DIRECT_RAM_PRE_EFFECT_RETRY&&result.sequence==32&&f.bridge.next_effect()==33);
 assert(f.bridge.owned_byte(0x300)==0&&f.board[0x300]==0&&f.bridge.generation_at(0x300)==32);
 denies([&]{f.bridge.close();});
 // The modeled CPU3 alias ledger can be empty while the owner's journal is full.
 auto boundary=f.boundary(BW_COLD_DIRECT_RAM_PAUSED_OBSERVER);
 auto p=f.bridge.prepare(boundary);auto receipt=f.bridge.commit(p,f.view());assert(receipt.entries==32&&receipt.acknowledged==32);
 retry.source.owner_acknowledged_sequence=f.bridge.acknowledged();
 result=f.bridge.memory(retry);assert(result.status==BW_COLD_DIRECT_RAM_ACCEPTED&&result.sequence==33);
 assert(f.bridge.owned_byte(0x300)==0x77&&f.board[0x300]==0);
 auto replay=retry;replay.source.owner_committed_sequence=f.bridge.committed();
 replay.source.generation_before=f.bridge.generation_at(0x300);
 denies([&]{f.bridge.memory(replay);}); // Fresh ledger still cannot replay the committed effect.
 denies([&]{f.bridge.close();}); // The retried effect is now committed but unacknowledged.
 p=f.bridge.prepare(boundary);f.bridge.commit(p,f.view());f.bridge.close();
 assert(f.board[0x300]==0x77&&f.bridge.acknowledged()==33);
}

static void late_batch_conflict_is_atomic(){
 Fixture f;uint8_t first=0x31,second=0x32;
 assert(f.bridge.memory(f.write(0x100,first)).status==BW_COLD_DIRECT_RAM_ACCEPTED);
 assert(f.bridge.memory(f.write(0x1100,second)).status==BW_COLD_DIRECT_RAM_ACCEPTED);
 auto p=f.bridge.prepare(f.boundary());
 auto changed=p;changed.batch.entries[1].after[0]^=1;
 denies([&]{f.bridge.commit(changed,f.view());});
 assert(f.board[0x100]==0&&f.board[0x1100]==0&&f.bridge.acknowledged()==0);
 f.board[0x1100]=0xee;
 denies([&]{f.bridge.commit(p,f.view());});
 assert(f.board[0x100]==0&&f.generations[0]==0&&f.generations[1]==0&&f.bridge.acknowledged()==0);
 f.board[0x1100]=0;auto receipt=f.bridge.commit(p,f.view());
 assert(receipt.entries==2&&f.board[0x100]==first&&f.board[0x1100]==second);
}

static void wrong_retry_poison_is_pre_effect(){
 Fixture f;for(unsigned i=0;i<32;++i){uint8_t b=uint8_t(i+1);f.bridge.memory(f.write(0x200+i,b));}
 uint8_t byte=0x77;auto original=f.write(0x300,byte);
 assert(f.bridge.memory(original).status==BW_COLD_DIRECT_RAM_PRE_EFFECT_RETRY);
 uint8_t wrong=0x78;auto changed=original;changed.operand=&wrong;
 denies([&]{f.bridge.memory(changed);});
 assert(f.bridge.failed()&&f.bridge.committed()==32&&f.bridge.owned_byte(0x300)==0);
}

static void companion_committed_code_fence_is_distinct(){
 std::vector<uint8_t> ram(BW_COLD_DIRECT_RAM_RAM_BYTES,0),rom(BW_COLD_DIRECT_RAM_ROM_BYTES,0x42);
 Core core(ram,rom);auto shadow=core.make_shadow();
 core.execute_page(0x7000);auto result=core.write(0x7000,{0xa5},1,0,0);
 assert(result.fence==Fence::post_effect_code_write&&result.committed&&!result.retry_same_effect);
 assert(core.committed_sequence()==1&&core.next_effect()==2&&core.inspect_byte(0x7000)==0xa5);
 core.acknowledge_code_invalidation(7,1);
 auto batch=core.drain();core.reconcile_and_ack(batch,shadow);
 assert(core.acknowledged()==1&&core.journal_size()==0);
}

static void failstop_reentry_and_thread(){
 Fixture f;
 auto request=f.read(0,1);
 std::thread cross([&]{denies([&]{f.bridge.memory(request);});});cross.join();
 auto p=f.bridge.prepare(f.boundary());bool reentered=false;
 denies([&]{f.bridge.commit(p,f.view(),[&](const CommitReceipt&){
  denies([&]{f.bridge.acknowledged();});denies([&]{f.bridge.prepare(f.boundary());});reentered=true;});});
 assert(reentered&&f.bridge.failed());denies([&]{f.bridge.prepare(f.boundary());});
 Fixture other;p=other.bridge.prepare(other.boundary());
 denies([&]{other.bridge.commit(p,other.view(),[](const CommitReceipt&){throw std::runtime_error("observer");});});
 assert(other.bridge.failed());denies([&]{other.bridge.prepare(other.boundary());});
}

int main(){copied_identity_and_decode();preflight_before_ack_and_effect();page_clock_flush_is_not_page_admission();capacity_retry_and_distinct_ledgers();
 late_batch_conflict_is_atomic();wrong_retry_poison_is_pre_effect();companion_committed_code_fence_is_distinct();failstop_reentry_and_thread();
 std::cout<<"direct-RAM source controls PASS\n";}
