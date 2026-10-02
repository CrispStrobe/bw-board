import pathlib,hashlib,json,difflib
P=pathlib.Path(__file__).parent;a=(P/'original.cc').read_text();b=(P/'h4-generated.cc').read_text();checks=0
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
def check(x,label):
 global checks
 assert x,label;checks+=1
check(sha(a)=='a131583191a71a4a675c66339440d5ce6b4ae1332d5b14bef10d7a8d47e36c40','authenticated original')
header='/* H4 owned packed scalar protocol; unprofiled ABI2 exports unchanged. */\n';check(b.startswith(header),'candidate marker');body=b[len(header):]
as_=a.index('int scalar(');ae=a.index('\nbw_direct_callbacks callbacks=',as_);bs=body.index('int scalar(');be=body.index('\nbw_direct_callbacks callbacks=',bs)
check(body[:bs]==a[:as_],'all pre-scalar ownership/helper bytes unchanged');check(body[be:]==a[ae:],'all post-scalar native lifecycle/snapshot/export bytes unchanged');s=body[bs:be]
for text in ['type==napi_uint32_array&&length==3&&offset==0','napi_is_arraybuffer(env,ab,&ordinary))&&ordinary','napi_is_detached_arraybuffer(env,ab,&detached))&&!detached','backing==data&&backing_length==12','((uintptr_t)data%alignof(uint32_t))==0','memcpy(copied_words,data,sizeof copied_words);*value=copied_words[0];*epoch=copied_words[1];*a20=copied_words[2];']:
 check(text in s,text)
check(s.index('memcpy(copied_words')<s.index('napi_close_handle_scope'),'copy before further NAPI activity');check('BWNP1' not in b,'no old profiler schema')
(P/'generated.diff').write_text(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='authenticated-unprofiled-a131',tofile='H4')))
r={'status':'H4_EXACT_SCALAR_ONLY_SOURCE_DIFFERENTIAL_PASS_NO_RUNTIME_CLAIM','checks':checks,'baseNapiSha256':sha(a),'h4GeneratedNapiSha256':sha(b),'unchanged':'every byte before and after scalar callback, including memory/PAGE ownership and all lifecycle/snapshot/export functions','delta':'scalar callback returns owned copied u32[3] via one dynamic JS packedScalar call; no profiler/key caching'};(P/'source-differential-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
