/** The only extra native checkpoint gate for the aligned owned fixture. */
export function assertOwnedIdtr03ff(checkpoint){
  if(checkpoint?.tables?.idtrBase!==0 || checkpoint.tables.idtrLimit!==0x03ff)
    throw new Error('owned aligned fixture did not load reset-shaped IDTR 0:03ff');
}
