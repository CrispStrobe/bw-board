"""Authenticate the prior guest-qualified empty-batch packet, read-only."""
import hashlib,json,sys,zipfile
from pathlib import Path

ZIP_SHA='260ed36433b3c5e02461cae3b1d6fcd05fd49e9b191bdf8093014a3a9b304b0f'
ORIGINAL_SHA='3881456e5dd46f256640cd28af30117f0be1a92f1b2fe9df1712067c3ea31905'
HEAD='74ed000b13800725c9f33baa1213ebaf84d3ded6'
QUALIFIED='acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1'
def sha(data):return hashlib.sha256(data).hexdigest()
def authenticate(empty_path,original_path,output_path):
    empty=Path(empty_path);original=Path(original_path)
    assert empty.stat().st_size==4314643 and sha(empty.read_bytes())==ZIP_SHA,'exact empty actual ZIP'
    assert original.stat().st_size==2405475 and sha(original.read_bytes())==ORIGINAL_SHA,'exact original actual ZIP'
    with zipfile.ZipFile(empty) as z,zipfile.ZipFile(original) as held:
        names=z.namelist();assert len(names)==len(set(names))==44 and all(
            '/' not in n and '\\' not in n and n not in ('.','..') for n in names),'flat bounded members'
        inventory=json.loads(z.read('artifact-inventory.json'))['files']
        assert set(names)-set(inventory)=={'artifact-inventory.json'},'inventory covers members'
        for name in names:
            member=z.getinfo(name)
            assert member.file_size<=48*1024*1024,'bounded member'
            if name in inventory:
                data=z.read(name)
                assert len(data)==inventory[name]['bytes'] and sha(data)==inventory[name]['sha256'],name
        source=json.loads(z.read('empty-source-manifest.json'))
        assert source['schema']=='bw.cold-direct-ram.empty-actual-source.v1'
        assert source['harnessHead']==HEAD and source['qualifiedHead']==QUALIFIED
        assert source['provider']['heldSha256']=='e529866863d1d7644ee866565b32ceef39cf882ba67bc6f56f9e62ed8ccc6dc6'
        assert source['provider']['normalizedSha256']=='3f0d81c2fc92f54d238623db365af845f15a08c0eb27d456366c9adad8881635'
        admission=json.loads(z.read('empty-run-admission.json'))
        assert admission['status']=='ADMITTED_BEFORE_ADDON_LOAD' and admission['harnessHead']==HEAD
        assert admission['qualifiedHead']==QUALIFIED and admission['referenceZipSha256']==ORIGINAL_SHA
        for name in ('held-comparison.json','three-arm-comparison.json'):
            comparison=json.loads(z.read(name));assert comparison['parity']=='PASS',name
            assert comparison['target']==316562 and comparison['ports']==16475 and comparison['journalEntries']==91958
        assert z.read('held-direct.json')==held.read('direct.json'),'exact original direct report'
        changed=json.loads(z.read('changed-direct.json'))
        baseline=json.loads(z.read('held-direct.json'))
        assert set(changed)==set(baseline) and changed['admission']['sourceHead']==QUALIFIED
        for key in baseline:
            if key!='admission':assert changed[key]==baseline[key],'complete non-admission parity '+key
        assert changed['direct']['beforeClose']['committed']=='91958'
        assert changed['direct']['afterClose']['ownerClosed'] is True
        report={'schema':'bw.cold-direct-ram.empty-paired-prior-qualification.v1',
          'status':'AUTHENTICATED','emptyZipSha256':ZIP_SHA,'originalZipSha256':ORIGINAL_SHA,
          'emptyHarnessHead':HEAD,'qualifiedHead':QUALIFIED,'members':len(names),
          'directReportSha256':inventory['changed-direct.json']['sha256'],
          'originalDirectReportSha256':sha(z.read('held-direct.json')),
          'journalEntries':91958,'ports':16475,'target':316562}
    Path(output_path).open('x').write(json.dumps(report,sort_keys=True,indent=2)+'\n')
    return report
if __name__=='__main__':
    assert len(sys.argv)==4,'empty ZIP, original ZIP, exclusive output'
    print(json.dumps(authenticate(*sys.argv[1:]),sort_keys=True))
