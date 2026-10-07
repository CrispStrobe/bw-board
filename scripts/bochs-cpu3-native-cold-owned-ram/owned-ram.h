// Owned cold RAM interface prototype; not connected to an addon or CPU.
#ifndef BW_COLD_OWNED_RAM_H
#define BW_COLD_OWNED_RAM_H
#include <array>
#include <vector>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <functional>
#include <thread>
#include <atomic>
namespace bw_cold_owned_ram {
constexpr uint32_t ram_extent=0x180000,rom_extent=0x10000,journal_capacity=32;
enum class Kind:uint8_t {ram=1,rom=2,mmio=3,unmapped=4};
enum class Fence {none,pre_effect_journal_full,post_effect_code_write};
struct WriteResult {Fence fence;bool committed;bool retry_same_effect;uint64_t sequence;uint32_t decoded;};
struct Entry {
 uint64_t sequence,effect,n,q;uint32_t epoch,address,length,generation;
 std::array<uint8_t,16> before,after;
};
struct FenceState {uint64_t committed,acknowledged,next_effect;bool uncommitted_retry,committed_code_write;};
struct Batch {uint32_t epoch;uint64_t acknowledged,through;std::vector<Entry> entries;};
class Session;
class Shadow {
 friend class Session;
#ifdef BW_COLD_OWNED_RAM_TEST
 friend struct ShadowTestAccess;
#endif
 std::vector<uint8_t> bytes_;
 uint64_t acknowledged_=0;
 bool observing_=false;
 const Session *session_;
 uint64_t session_id_;
 Shadow(const std::vector<uint8_t>&bytes,const Session*session,uint64_t id):bytes_(bytes),session_(session),session_id_(id){}
 std::thread::id owner_=std::this_thread::get_id();
 void owner_only()const {if(std::this_thread::get_id()!=owner_)throw std::runtime_error("shadow owner thread");}
public:
 Shadow(const Shadow&)=delete;Shadow&operator=(const Shadow&)=delete;
 uint8_t diagnostic_byte(uint32_t address)const {owner_only();return bytes_.at(address);}
 uint8_t observer_byte(uint32_t address)const {owner_only();if(!observing_)throw std::runtime_error("shadow observer admission");return bytes_.at(address);}
 uint64_t acknowledged()const{owner_only();return acknowledged_;}
};
class Session {
 inline static std::atomic<uint64_t> issued_ids_{0};
 static uint64_t issue_id(){uint64_t old=issued_ids_.load(std::memory_order_relaxed);for(;;){if(old==UINT64_MAX)throw std::overflow_error("owned RAM session identity overflow");if(issued_ids_.compare_exchange_weak(old,old+1,std::memory_order_relaxed))return old+1;}}
 const uint64_t id_;
 std::vector<uint8_t> ram_,rom_;
 std::array<Entry,journal_capacity> entries_{};
 std::array<uint32_t,ram_extent/4096> generations_{};
 std::array<bool,ram_extent/4096> executed_{};
 unsigned count_=0;
 uint64_t sequence_=0,acknowledged_=0,next_effect_=1;
 uint64_t last_n_=0,last_q_=0;
 bool failed_=false,closed_=false,observing_=false,code_pending_=false,retry_pending_=false,retry_executable_=false,shadow_issued_=false;
 uint32_t retry_raw_=0;Entry retry_{};
 uint32_t pending_page_=0,pending_generation_=0;
 std::thread::id owner_=std::this_thread::get_id();
 void require(bool condition,const char *why){if(!condition){failed_=true;throw std::runtime_error(why);}}
 void owner_only()const {if(std::this_thread::get_id()!=owner_)throw std::runtime_error("owned RAM owner thread");}
 void gate(bool needs_shadow=true){owner_only();require(!failed_&&!closed_,"failed/closed owned RAM session");require(!observing_,"owned RAM observer reentry");require(!needs_shadow||shadow_issued_,"unique initial shadow required");}
 static bool same(const Entry&a,const Entry&b){return a.sequence==b.sequence&&a.effect==b.effect&&a.n==b.n&&a.q==b.q&&a.epoch==b.epoch&&a.address==b.address&&a.length==b.length&&a.generation==b.generation&&a.before==b.before&&a.after==b.after;}
 uint32_t span(uint32_t raw,uint32_t length,Kind&kind){
  require(length&&length<=16&&uint64_t(raw)+length<=uint64_t(UINT32_MAX)+1&&(raw&4095)+length<=4096,"fixed raw span");
  const uint32_t decoded=decode(raw);kind=classify(decoded);require(kind!=Kind::mmio,"MMIO not owned");
  require(uint64_t(decoded)+length<=uint64_t(UINT32_MAX)+1&&(decoded&4095)+length<=4096,"decoded span");
  for(uint32_t i=0;i<length;++i)require(decode(raw+i)==decoded+i&&classify(decoded+i)==kind,"whole span decode kind");
  return decoded;
 }
 void reconcile(const Batch&batch,Shadow&shadow){
  require(shadow.owner_==owner_&&shadow.session_==this&&shadow.session_id_==id_,"fixed shadow owner/session");
  require(batch.epoch==0&&batch.acknowledged==acknowledged_&&shadow.acknowledged_==acknowledged_&&batch.through==sequence_&&batch.entries.size()==count_,"contiguous journal watermark");
  for(unsigned i=0;i<count_;++i)require(same(batch.entries[i],entries_[i])&&entries_[i].sequence==acknowledged_+i+1,"exact copied journal");
  // Validate every original byte against an overlay of earlier entries BEFORE any shadow mutation.
  for(unsigned i=0;i<count_;++i){const Entry&e=entries_[i];
   for(unsigned j=0;j<e.length;++j){uint32_t address=e.address+j;uint8_t want=shadow.bytes_[address];
    for(unsigned k=0;k<i;++k){const Entry&prior=entries_[k];if(address>=prior.address&&address<prior.address+prior.length)want=prior.after[address-prior.address];}
    require(want==e.before[j],"shadow before-byte reconciliation");
   }
  }
  // All checks complete; fixed vector extent means this commit loop cannot allocate or throw.
  for(unsigned i=0;i<count_;++i)for(unsigned j=0;j<entries_[i].length;++j)shadow.bytes_[entries_[i].address+j]=entries_[i].after[j];
  shadow.acknowledged_=sequence_;acknowledged_=sequence_;count_=0;
 }
public:
 explicit Session(const std::vector<uint8_t>&ram,const std::vector<uint8_t>&rom):id_(issue_id()),ram_(ram),rom_(rom){if(ram.size()!=ram_extent||rom.size()!=rom_extent)throw std::invalid_argument("fixed copied RAM/ROM extent");}
 static uint32_t decode(uint32_t raw){return raw>=0xffff0000?0xff0000+(raw-0xffff0000):raw;}
 static Kind classify(uint32_t a){if(a<=0x9ffff||(a>=0x100000&&a<=0x17ffff))return Kind::ram;if((a>=0xf0000&&a<=0xfffff)||(a>=0xff0000&&a<=0xffffff))return Kind::rom;if(a>=0xa0000&&a<=0xbffff)return Kind::mmio;return Kind::unmapped;}
 Shadow make_shadow(){gate(false);require(!shadow_issued_&&sequence_==0&&count_==0,"one full initial shadow association");shadow_issued_=true;try{return Shadow(ram_,this,id_);}catch(...){failed_=true;throw;}}
 Session(const Session&)=delete;Session&operator=(const Session&)=delete;
 bool failed()const{owner_only();return failed_;}
 bool closed()const{owner_only();return closed_;}
 FenceState fence_state()const{owner_only();return {sequence_,acknowledged_,next_effect_,retry_pending_,code_pending_};}
 uint64_t acknowledged()const{owner_only();return acknowledged_;}
 uint64_t committed_sequence()const{owner_only();return sequence_;}
 uint64_t next_effect()const{owner_only();return next_effect_;}
 uint32_t generation_at(uint32_t address)const{owner_only();if(address>=ram_extent)throw std::out_of_range("owned RAM generation address");return generations_[address/4096];}
 unsigned journal_size()const{owner_only();return count_;}
 bool code_pending()const{owner_only();return code_pending_;}
 uint8_t inspect_byte(uint32_t address)const{owner_only();return ram_.at(address);}
 std::array<uint8_t,16> read(uint32_t raw,uint32_t length){gate();require(!code_pending_&&!retry_pending_,"pending execution fence");Kind kind;uint32_t address=span(raw,length,kind);std::array<uint8_t,16> out{};for(uint32_t i=0;i<length;++i)out[i]=kind==Kind::ram?ram_[address+i]:kind==Kind::rom?rom_[(address+i)&0xffff]:0xff;return out;}
 std::array<uint8_t,4096> execute_page(uint32_t raw){
  gate();require(!code_pending_&&!retry_pending_&&!(raw&4095),"pending/alignment execute fence");uint32_t address=decode(raw);Kind kind=classify(address);
  require(kind==Kind::ram||kind==Kind::rom,"owned executable decode");for(unsigned i=0;i<4096;++i)require(decode(raw+i)==address+i&&classify(address+i)==kind,"whole executable page kind");
  std::array<uint8_t,4096> out{};for(unsigned i=0;i<4096;++i)out[i]=kind==Kind::ram?ram_[address+i]:rom_[(address+i)&0xffff];if(kind==Kind::ram)executed_[address/4096]=true;return out;
 }
 WriteResult write(uint32_t raw,const std::vector<uint8_t>&bytes,uint64_t effect,uint64_t n,uint64_t q){
  gate();require(!code_pending_,"code-write fence not acknowledged");require(!bytes.empty()&&bytes.size()<=16,"fixed write byte length");Kind kind;uint32_t address=span(raw,uint32_t(bytes.size()),kind);const bool executable=kind==Kind::ram&&executed_[address/4096];
  require(effect==next_effect_&&effect<UINT64_MAX,"once-only effect ordinal");require(q<=n&&n>=last_n_&&q>=last_q_,"valid monotonic effect ledger Q<=N");
  if(retry_pending_){require(raw==retry_raw_&&address==retry_.address&&bytes.size()==retry_.length&&effect==retry_.effect&&n==retry_.n&&q==retry_.q&&executable==retry_executable_,"exact uncommitted effect retry");for(unsigned i=0;i<bytes.size();++i)require(bytes[i]==retry_.after[i],"exact retry bytes");}
  if(kind!=Kind::ram){require(!executable,"non-RAM executable write");++next_effect_;last_n_=n;last_q_=q;return {Fence::none,false,false,sequence_,address};}
  // Reserve the WHOLE one-page multi-byte effect before mutation; full journal is an uncommitted retry fence.
  if(count_==journal_capacity){retry_pending_=true;retry_raw_=raw;retry_executable_=executable;retry_={};retry_.effect=effect;retry_.address=address;retry_.length=uint32_t(bytes.size());retry_.n=n;retry_.q=q;for(unsigned i=0;i<bytes.size();++i)retry_.after[i]=bytes[i];return {Fence::pre_effect_journal_full,false,true,sequence_,address};}
  const uint32_t page=address/4096;require(sequence_<UINT64_MAX&&generations_[page]<UINT32_MAX,"journal/generation overflow");
  Entry entry{};entry.sequence=sequence_+1;entry.effect=effect;entry.n=n;entry.q=q;entry.epoch=0;entry.address=address;entry.length=uint32_t(bytes.size());entry.generation=generations_[page]+1;
  for(uint32_t i=0;i<entry.length;++i){entry.before[i]=ram_[address+i];entry.after[i]=bytes[i];}
  entries_[count_]=entry; // Reservation and complete before/after record exist before the atomic write.
  for(uint32_t i=0;i<entry.length;++i)ram_[address+i]=entry.after[i];
  ++count_;++sequence_;++generations_[page];++next_effect_;last_n_=n;last_q_=q;retry_pending_=false;
  if(executable){code_pending_=true;pending_page_=page;pending_generation_=entry.generation;return {Fence::post_effect_code_write,true,false,sequence_,address};}
  return {Fence::none,true,false,sequence_,address};
 }
 Batch drain(){gate();Batch batch{0,acknowledged_,sequence_,{}};batch.entries.assign(entries_.begin(),entries_.begin()+count_);return batch;}
 void reconcile_and_ack(const Batch&batch,Shadow&shadow){gate();reconcile(batch,shadow);}
 void acknowledge_code_invalidation(uint32_t page,uint32_t generation){gate();require(code_pending_&&page==pending_page_&&generation==pending_generation_,"exact committed code generation");code_pending_=false;}
 bool execution_ready(){gate();return !code_pending_&&!retry_pending_;}
 void before_observer(Shadow&shadow,const std::function<void(const Shadow&)>&observer){
  gate();require(!code_pending_,"invalidate code before observer/execution");Batch batch=drain();reconcile(batch,shadow);observing_=true;shadow.observing_=true;
  try{observer(shadow);shadow.observing_=false;observing_=false;}catch(...){shadow.observing_=false;observing_=false;failed_=true;throw;}
  require(!failed_,"observer attempted forbidden reentry");
 }
 void close(Shadow&shadow){gate();require(!code_pending_&&!retry_pending_,"close cannot discard pending effects");Batch batch=drain();reconcile(batch,shadow);closed_=true;}
};
}
#endif
