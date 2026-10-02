/* Static storage survives Bochs longjmp. No native buffer escapes to JS. */
static uint32_t bw_owned_tape[900],bw_owned_count=0;
static bw_owned_clock_state bw_owned={0,0,4,0,6000,0,1};
static uint64_t bw_owned_calls=0,bw_owned_commits=0,bw_owned_words=0;
static bool bw_owned_initialized=false;
static uint32_t bw_owned_query_phase=0;
static void bw_owned_empty(void){if(bw_owned_count)bw_slice_fail("owned-paused-pending");}
static void bw_owned_transfer(uint32_t reason,bool query=false){
  if(!bw_direct_host.clock_transfer)bw_slice_fail("owned-transfer-missing");
  if(query){if(bw_owned_count||bw_owned_query_phase!=reason||(reason!=BW_OWNED_INIT&&reason!=BW_OWNED_ENTRY&&reason!=BW_OWNED_POST_PIO))bw_slice_fail("owned-query-phase");}
  else{if(!bw_in_resume)bw_slice_fail("owned-transfer-outside-resume");if(!bw_owned_count)return;}
  if(reason==BW_OWNED_INIT){if(bw_owned_initialized||bw_in_resume)bw_slice_fail("owned-init-phase");}
  else if(!bw_in_resume)bw_slice_fail("owned-query-outside-resume");
  if(bw_owned.n!=bw_ticks||bw_owned.q!=bw_successful_quanta)bw_slice_fail("owned-native-ledger");
  bw_owned_clock_state r={};
  if(!bw_direct_host.clock_transfer(bw_direct_host.context,bw_owned_tape,bw_owned_count,reason,&r))bw_slice_fail("owned-transfer-callback");
  ++bw_owned_calls;
  uint32_t expectedEpoch=bw_mapping_pending?bw_next_epoch:bw_mapping_epoch;
  uint32_t expectedA20=bw_mapping_pending?bw_next_a20:bw_board_a20;
  if(r.n!=bw_owned.n||r.q!=bw_owned.q||r.cycles!=bw_owned.cycles||r.cycles!=4+6*r.q||r.epoch!=expectedEpoch||r.a20!=expectedA20||!r.deadline||r.deadline>6000||r.debt>r.deadline+5)bw_slice_fail("owned-state-reply");
  if(!query&&(r.debt!=bw_owned.debt||r.deadline!=bw_owned.deadline))bw_slice_fail("owned-clock-reply");
  if(reason==BW_OWNED_INIT&&(r.n||r.q||r.cycles!=4||r.debt||r.deadline!=6000||r.epoch||r.a20!=1))bw_slice_fail("owned-reset-reply");
  // ENTRY/POST_PIO clock transitions are produced and validated by the private
  // source-owned actual chip provider. C checks phase/domain, not a fictitious PIT.
  if(reason==BW_OWNED_ENTRY&&r.debt>=r.deadline)bw_slice_fail("owned-entry-due");
  if(reason==BW_OWNED_POST_PIO&&r.debt)bw_slice_fail("owned-pio-debt");
  bw_owned.debt=r.debt;bw_owned.deadline=r.deadline;bw_owned.epoch=expectedEpoch;bw_owned.a20=expectedA20;
  if(query)bw_owned_query_phase=0;
  if(!query){++bw_owned_commits;bw_owned_words+=bw_owned_count;bw_owned_count=0;}
  if(reason==BW_OWNED_INIT)bw_owned_initialized=true;
}
static void bw_owned_append(uint32_t word){
  if(!bw_in_resume||!bw_owned_initialized||bw_owned_count>=900)bw_slice_fail("owned-tape-capacity");
  if(word==BW_OWNED_N1){
    if(bw_mapping_pending)bw_slice_fail("owned-N-mapping-pending");
    if(bw_slice_ticks>=bw_native_budget||bw_owned.n>=160000)bw_slice_fail("owned-N-cap");
    ++bw_owned.n;
  }else if(word==BW_OWNED_Q0||word==BW_OWNED_QREP){
    if(bw_mapping_pending&&word!=BW_OWNED_Q0)bw_slice_fail("owned-Q-mapping-pending");
    if(bw_slice_quanta>=bw_quantum_budget||bw_owned.q>=150000||bw_owned.debt>=bw_owned.deadline)bw_slice_fail("owned-Q-cap-or-due");
    ++bw_owned.q;bw_owned.cycles+=6;bw_owned.debt+=6;
  }else bw_slice_fail("owned-word");
  bw_owned_tape[bw_owned_count++]=word;
}
