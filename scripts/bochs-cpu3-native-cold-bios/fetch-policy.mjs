/** Source-owned expressions shared by generated C and nonguest behavioral controls. */
export const domainArguments=Object.freeze(['selector','cs32','pe','interrupts','base','eip','length','start','mappingPending','a20']);
export const domainExpression='selector==0xf000 && !cs32 && !pe && !interrupts && (base==0xf0000 || base==0xffff0000) && eip<=65535 && length>=1 && length<=15 && length<=65536-eip && start<=4294967295 && length-1<=4294967295-start && !mappingPending && a20==1';
export const pageArguments=Object.freeze(['found','rawPage','expectedRawPage','epoch','expectedEpoch','kind','decoded','expectedDecoded','byte','expectedByte']);
export const pageExpression='found && rawPage==expectedRawPage && epoch==expectedEpoch && kind==2 && decoded==expectedDecoded && byte==expectedByte';
export const cHelpers=`
static bool bw_cold_fetch_domain(uint32_t selector,bool cs32,bool pe,bool interrupts,uint64_t base,uint32_t eip,unsigned length,uint64_t start,bool mappingPending,unsigned a20){return ${domainExpression};}
static bool bw_cold_fetch_page(bool found,uint32_t rawPage,uint32_t expectedRawPage,uint32_t epoch,uint32_t expectedEpoch,unsigned kind,uint32_t decoded,uint32_t expectedDecoded,unsigned byte,unsigned expectedByte){return ${pageExpression};}
`;
