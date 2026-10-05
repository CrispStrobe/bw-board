"""Bounded lossless evidence decoding; no source restoration or child execution."""
import hashlib,json,zlib,stat
from pathlib import Path
DECODED_CAP=64<<20
STORED_CAP=16<<20
OUTCOME_CAP=128<<10

def require(condition,message):
 if not condition:raise ValueError(message)
def ordinary(path,cap):
 p=Path(path);s=p.lstat();require(stat.S_ISREG(s.st_mode)and not p.is_symlink()and s.st_size<=cap,'bounded regular evidence')
 b=p.read_bytes();require(len(b)==s.st_size,'stable evidence size');return b
def sha(b):return hashlib.sha256(b).hexdigest()
def read_outcome(directory):
 out=json.loads(ordinary(Path(directory)/'outcome.json',OUTCOME_CAP));require(isinstance(out,dict)and out.get('schema')=='bw.paged-int-iret.evidence-outcome.v1','owned outcome schema');return out
def read_capture(directory):
 directory=Path(directory);out=read_outcome(directory)
 require(out.get('schema')=='bw.paged-int-iret.evidence-outcome.v1'and out.get('status')=='PASS'and out.get('parityStatus')=='PASS'and out.get('bodyComplete')is True,'completed evidence outcome PASS')
 require(out.get('primaryError')is None and out.get('persistenceError')is None,'no primary or persistence error')
 body=out.get('body');require(isinstance(body,dict)and set(body)=={'filename','decodedBytes','storedBytes','decodedSha256','storedSha256','encoding','decodedCap','storedCap'},'exact compressed body metadata')
 require(body['filename']=='capture.json.gz'and body['encoding']=='gzip-single-member-json'and body['decodedCap']==DECODED_CAP and body['storedCap']==STORED_CAP,'owned compressed body format')
 for key,cap in [('decodedBytes',DECODED_CAP),('storedBytes',STORED_CAP)]:require(type(body[key])is int and 0<body[key]<=cap,'declared byte cap')
 for key in ['decodedSha256','storedSha256']:require(isinstance(body[key],str)and len(body[key])==64 and all(c in '0123456789abcdef'for c in body[key]),'declared SHA256')
 packed=ordinary(directory/body['filename'],STORED_CAP);require(len(packed)==body['storedBytes']and sha(packed)==body['storedSha256'],'complete stored bytes/digest')
 inflater=zlib.decompressobj(31);decoded=inflater.decompress(packed,DECODED_CAP+1)
 require(len(decoded)<=DECODED_CAP,'decoded byte cap');require(inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail,'one complete gzip member without trailing bytes')
 require(len(decoded)==body['decodedBytes']and sha(decoded)==body['decodedSha256'],'complete decoded bytes/digest')
 capture=json.loads(decoded);require(capture.get('status')=='PASS','logical receipt PASS');require(capture.get('progress')==out.get('progress'),'independent outcome progress matches receipt')
 return capture,out
