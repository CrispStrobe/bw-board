// Closed test-fixture artifact gate; accepts no caller paths/factory.
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
const own=new URL('./',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
export function authenticatedFixturePath(){
 const c=JSON.parse(readFileSync(new URL('contract.json',own),'utf8'));
 if(c.status!=='ROOT_REVIEWED_REAL_NAPI_FIXTURE_READY'||!c.addonSha256||!c.generatedHelperSha256||!c.buildReceiptSha256)throw Error('PENDING real-NAPI fixture authority; no addon load');
 if(c.addonPath!=='./owned-build/key_fixture.node'||c.nodeVersion!=='22.23.3'||c.nodeSha256!=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48')throw Error('fixed fixture/Node authority');
 if(process.versions.node!==c.nodeVersion||hash(readFileSync(realpathSync(process.execPath)))!==c.nodeSha256)throw Error('actual Node identity mismatch');
 const context=JSON.parse(readFileSync(new URL('candidate-source-context.json',own),'utf8'));
 const helper=readFileSync(new URL('owned-build/generated-helper.inc',own));
 if(hash(helper)!==c.generatedHelperSha256||hash(helper)!==context.expectedHelperSha256)throw Error('actual generated-helper hash mismatch');
 const bytes=readFileSync(new URL('owned-build/build-receipt.json',own));if(hash(bytes)!==c.buildReceiptSha256)throw Error('actual build receipt hash mismatch');
 const receipt=JSON.parse(bytes),fixture=hash(readFileSync(new URL('fixture.cc',own)));
 if(receipt.schema!=='bw.property-key.fixture-build.v1'||receipt.status!=='BUILD_STATIC_PASS'||receipt.candidateRevision!==c.candidateRevision||receipt.candidateRevision!==context.revision||receipt.helperSha256!==c.generatedHelperSha256||receipt.fixtureSha256!==fixture||receipt.addonSha256!==c.addonSha256||receipt.nodeSha256!==c.nodeSha256)throw Error('fixed build receipt binding mismatch');
 const path=new URL('owned-build/key_fixture.node',own);if(hash(readFileSync(path))!==c.addonSha256)throw Error('actual addon hash mismatch');
 return path.pathname;
}
