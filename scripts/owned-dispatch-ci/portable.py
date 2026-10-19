"""Exact path-only frozen CLI/config admission derivatives; no addon load."""
from pathlib import Path
import re,hashlib
sha=lambda b:hashlib.sha256(b).hexdigest()
def runner(text,root,admission):
 original=text;assert sha(original.encode())in ['68f85005a471c2ccade1d4dcfbbf2794fb0161fc7536e9c4b9bcb1dc05c9578b','ad21a082496beb6fac54b051c5b453404d71c93a316d6078c2e56c7744ed2115'];seams=[]
 for m in list(re.finditer(r"from (['\"])(\./[^'\"]+)\1",text)):
  old=m.group(0);new='from '+repr(str((Path(root)/'scripts'/m.group(2)).resolve()));assert text.count(old)==1;text=text.replace(old,new);seams.append((old,new))
 old=str(Path(root)/'scripts/bochs-cpu3-native-owned-in8/admission.mjs');new=str(admission);assert text.count(old)==1;text=text.replace(old,new);seams.append((old,new))
 inverse=text
 for before,after in reversed(seams):assert inverse.count(after)==1;inverse=inverse.replace(after,before)
 assert inverse==original
 return text,{'originalSha256':sha(original.encode()),'derivedSha256':sha(text.encode()),'seams':seams,'inverseExact':True}
def configuration(text,compiled,log):
 original=text;seams=[]
 for key in ['romimage','vgaromimage']:
  matches=list(re.finditer(r'^'+key+r': file=([^\s,\"]+)',text,re.M));assert len(matches)==1
  old=matches[0][1];new=str(Path(compiled)/'roms/free-at-bios'/Path(old).name);assert text.count(old)==1;text=text.replace(old,new);seams.append((old,new))
 matches=list(re.finditer(r'^log: ([^\n]+)$',text,re.M));assert len(matches)==1;old=matches[0][1];new=str(log);assert text.count(old)==1;text=text.replace(old,new);seams.append((old,new))
 inverse=text
 for before,after in reversed(seams):assert inverse.count(after)==1;inverse=inverse.replace(after,before)
 assert inverse==original
 return text,{'originalSha256':sha(original.encode()),'derivedSha256':sha(text.encode()),'seams':seams,'inverseExact':True}
def admission(text,root,config_sha):
 original=text;assert sha(original.encode())=='f844e844d6460bac1c0fe00746f44243f75e0cf79eef79b1f7ef501685544bbb';root=Path(root);seams=[("'../bochs-cpu3-native-owned-clock/derive.mjs'",repr(str(root/'scripts/bochs-cpu3-native-owned-clock/derive.mjs'))),("'../bochs-cpu3-native-combined-paging-ram/host.mjs'",repr(str(root/'scripts/bochs-cpu3-native-combined-paging-ram/host.mjs'))),("fileURLToPath(new URL('../../',import.meta.url))",repr(str(root)+'/')),('5683c4731d60804502b17ee0653085ef761137199878880b3b5ed64fd0a49d3d',config_sha)]
 for before,after in seams:assert text.count(before)==1;text=text.replace(before,after)
 inverse=text
 for before,after in reversed(seams):assert inverse.count(after)==1;inverse=inverse.replace(after,before)
 assert inverse==original
 return text,{'originalSha256':sha(original.encode()),'derivedSha256':sha(text.encode()),'seams':seams,'inverseExact':True}
