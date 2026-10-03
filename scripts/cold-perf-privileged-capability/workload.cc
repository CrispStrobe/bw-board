// Fixed nonguest O2 callchain/thread fixture. No emulator, addon or media.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>
#include <unistd.h>
#include <sys/syscall.h>
static std::atomic<unsigned long> sink{0};
extern "C" __attribute__((noinline)) unsigned long leaf(unsigned long x){for(unsigned i=0;i<4096;++i)x=x*1664525+1013904223;return x;}
extern "C" __attribute__((noinline)) unsigned long middle(unsigned long x){volatile unsigned long value=leaf(x);return value+1;}
extern "C" __attribute__((noinline)) void chain(){std::printf("WORKLOAD_TID %ld\n",syscall(SYS_gettid));std::fflush(stdout);auto end=std::chrono::steady_clock::now()+std::chrono::milliseconds(1250);unsigned long value=1;while(std::chrono::steady_clock::now()<end)value=middle(value);sink.fetch_add(value);}
int main(){std::thread child(chain);chain();child.join();std::printf("WORKLOAD_DONE %lu\n",sink.load());}
