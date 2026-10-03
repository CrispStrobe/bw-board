/** Cold-only data-byte guard over the initializer-authenticated unmodified ROM.
 * No execution-cache warming, mutable byte normalization or generic ROM admission. */
export const coldRomObservedHelper=String.raw`static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length){
  if(!bytes||!length||length>16||(address&4095U)+length>4096U)return false;
  const bool low=address>=0xf0000U&&address<=0xfffffU;
  const bool high=address>=0xff0000U&&address<=0xffffffU;
  if((!low&&!high)||length>65536U-(address&65535U))return false;
  return memcmp(bw_direct_rom+(address&65535U),bytes,length)==0;
}`;
