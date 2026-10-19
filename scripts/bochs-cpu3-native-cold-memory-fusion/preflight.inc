/* Production-used predicate, evaluated before the fused JS callback. */
static bool bw_fusion_preflight(bool clock_present,bool in_resume,bool initialized,bool reply_pending,uint64_t n,uint64_t ticks,uint64_t q,uint64_t quanta){
 return clock_present&&in_resume&&initialized&&!reply_pending&&n==ticks&&q==quanta;
}
