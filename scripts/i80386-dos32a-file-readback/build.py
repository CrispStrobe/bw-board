#!/usr/bin/env python3
"""Authored LE32 file-input client. No compiler, MZ stub or extender bytes."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
GUARD=bytes.fromhex('a55aa55a3cc33cc3')
CASES={'a':bytes((37*i+0x11)&255 for i in range(17)), 'b':bytes((53*i+0xa7)&255 for i in range(31))}

def payload():
    code=bytearray();labels={};relative=[];pointers=[];roles=[];loops=0
    def emit(raw):code.extend(raw)
    def label(name):
        if name in labels:raise ValueError('duplicate label')
        labels[name]=len(code)
    def jump(op,name):emit(op);relative.append((len(code),name));emit(b'\0'*4)
    def memory(op,reg,name,delta=0):
        emit(op+bytes([0x85+(reg<<3)]));pointers.append((len(code),name,delta));emit(b'\0'*4)
    def address(reg,name,delta=0):memory(b'\x8d',reg,name,delta)
    def load(reg,name,delta=0):memory(b'\x8b',reg,name,delta)
    def store(reg,name,delta=0):memory(b'\x89',reg,name,delta)
    def byte_store(reg,name,delta=0):memory(b'\x88',reg,name,delta)
    def immediate(reg,value):emit(bytes([0xb8+reg])+struct.pack('<I',value))
    def mark(name):label(name);roles.append(name)
    def call(name,failure):
        mark(name+'_call');emit(b'\xcd\x21');mark(name+'_return')
        if failure is not None:jump(b'\x0f\x82',failure)
    def compare_eax(value,failure):emit(b'\x3d'+struct.pack('<I',value));jump(b'\x0f\x85',failure)
    def handle(name,failure):
        emit(b'\x3d\xff\xff\x00\x00');jump(b'\x0f\x87',failure);store(0,name)
    def exact_count(name,failure):memory(b'\x3b',0,name);jump(b'\x0f\x85',failure)
    def check_guard(name,failure):
        for delta,value in [(0,0x5aa55aa5),(4,0xc33cc33c)]:
            memory(b'\x81',7,name,delta);emit(struct.pack('<I',value));jump(b'\x0f\x85',failure)
    def check_cc(name,size,failure,skip_length=False):
        nonlocal loops
        address(6,name);immediate(1,size)
        if skip_length:memory(b'\x03',6,'length');memory(b'\x2b',1,'length')
        loop='cc_loop_'+str(loops);loops+=1;label(loop)
        emit(b'\x80\x3e\xcc');jump(b'\x0f\x85',failure);emit(b'\x46\x49');jump(b'\x0f\x85',loop)
    def compare_bytes(buffer,size=None,tail=False):
        nonlocal loops
        load(6,'selected');address(7,buffer)
        if tail:memory(b'\x03',6,'length');emit(b'\x83\xee\x05')
        if size is None:load(1,'length')
        else:immediate(1,size)
        loop='compare_loop_'+str(loops);loops+=1;label(loop)
        emit(b'\x8a\x06\x3a\x07');jump(b'\x0f\x85','read_fail');emit(b'\x46\x47\x49');jump(b'\x0f\x85',loop)
    def copy(source,size,destination):
        nonlocal loops
        address(6,source);address(7,'proof',destination);immediate(1,size)
        loop='copy_loop_'+str(loops);loops+=1;label(loop)
        emit(b'\x8a\x06\x88\x07\x46\x47\x49');jump(b'\x0f\x85',loop)
    mark('entry');emit(b'\xe8\0\0\0\0\x5d')
    address(2,'ready');immediate(0,0x900);emit(b'\xcd\x21')
    immediate(0,0x800);call('input',None)  # AH08 does not define carry as a result.
    emit(b'\x0f\xb6\xc0\x3c\x61');jump(b'\x0f\x82','fail');emit(b'\x3c\x62');jump(b'\x0f\x87','fail')
    byte_store(0,'proof',5);address(6,'payload_a');immediate(1,17)
    emit(b'\x3c\x61');jump(b'\x0f\x84','selected_case');address(6,'payload_b');immediate(1,31)
    label('selected_case');store(6,'selected');store(1,'length');byte_store(1,'proof',6)
    address(2,'data_path');immediate(1,0);immediate(0,0x3c00);call('data_create','fail');handle('write_handle','fail')
    load(3,'write_handle');load(2,'selected');load(1,'length');immediate(0,0x4000);call('data_write','write_fail');exact_count('length','write_fail')
    load(3,'write_handle');immediate(0,0x3e00);call('data_close','fail')
    address(2,'data_path');immediate(0,0x3d00);call('reopen','fail');handle('read_handle','fail')
    load(3,'read_handle');address(2,'full_buffer');load(1,'length');immediate(0,0x3f00);call('full','read_fail');exact_count('length','read_fail')
    store(0,'saved_counts');byte_store(0,'proof',7);compare_bytes('full_buffer');check_cc('full_buffer',64,'read_fail',True)
    check_guard('full_prefix','read_fail');check_guard('full_suffix','read_fail')
    load(3,'read_handle');load(2,'length');emit(b'\x83\xea\x05');immediate(1,0);immediate(0,0x4200);call('seek','read_fail')
    load(1,'length');emit(b'\x83\xe9\x05\x39\xc8');jump(b'\x0f\x85','read_fail');emit(b'\x85\xd2');jump(b'\x0f\x85','read_fail')
    load(3,'read_handle');address(2,'tail_buffer');immediate(1,8);immediate(0,0x3f00);call('short','read_fail');compare_eax(5,'read_fail')
    store(0,'saved_counts',4);byte_store(0,'proof',8);compare_bytes('tail_buffer',5,True);check_cc('tail_unread',11,'read_fail')
    check_guard('tail_prefix','read_fail');check_guard('tail_suffix','read_fail')
    load(3,'read_handle');address(2,'eof_buffer');immediate(1,1);immediate(0,0x3f00);call('eof','read_fail');compare_eax(0,'read_fail')
    store(0,'saved_counts',8);byte_store(0,'proof',9);check_cc('eof_buffer',16,'read_fail')
    check_guard('eof_prefix','read_fail');check_guard('eof_suffix','read_fail')
    load(3,'read_handle');immediate(0,0x3e00);call('read_close','fail')
    for name,n,at in [('full_buffer',64,11),('tail_buffer',16,75),('eof_buffer',16,91),('full_prefix',8,107),('full_suffix',8,115),('tail_prefix',8,123),('tail_suffix',8,131),('eof_prefix',8,139),('eof_suffix',8,147)]:copy(name,n,at)
    memory(b'\xc6',0,'proof',10);emit(b'\xa5');mark('proof_ready')
    address(2,'proof_path');immediate(1,0);immediate(0,0x3c00);call('proof_create','fail');handle('proof_handle','fail')
    load(3,'proof_handle');address(2,'proof');immediate(1,155);immediate(0,0x4000);call('proof_write','proof_fail');compare_eax(155,'proof_fail')
    load(3,'proof_handle');immediate(0,0x3e00);call('proof_close','fail')
    address(2,'done');immediate(0,0x900);emit(b'\xcd\x21');immediate(0,0x4c00);mark('exit');emit(b'\xcd\x21')
    for failed,slot in [('write_fail','write_handle'),('read_fail','read_handle'),('proof_fail','proof_handle')]:
        label(failed);load(3,slot);immediate(0,0x3e00);emit(b'\xcd\x21');jump(b'\xe9','fail')
    label('fail');address(2,'bad');immediate(0,0x900);emit(b'\xcd\x21');immediate(0,0x4c01);emit(b'\xcd\x21')
    for name,data in [('ready',b'BW-LE-FILE-READY\r\n$'),('done',b'BW-LE-FILE-CLOSED\r\n$'),('bad',b'BW-LE-FILE-FAIL\r\n$'),('data_path',b'C:\\DATA.BIN\0'),('proof_path',b'C:\\RESULT.BIN\0'),('selected',bytes(4)),('length',bytes(4)),('write_handle',bytes(4)),('read_handle',bytes(4)),('proof_handle',bytes(4)),('saved_counts',bytes(12)),('payload_a',CASES['a']),('payload_b',CASES['b']),('proof',b'BWFR1'+bytes(150)),('full_prefix',GUARD),('full_buffer',b'\xcc'*64),('full_suffix',GUARD),('tail_prefix',GUARD),('tail_buffer',b'\xcc'*16),('tail_suffix',GUARD),('eof_prefix',GUARD),('eof_buffer',b'\xcc'*16),('eof_suffix',GUARD)]:
        label(name);emit(data)
    labels['tail_unread']=labels['tail_buffer']+5
    for at,name in relative:struct.pack_into('<i',code,at,labels[name]-at-4)
    for at,name,delta in pointers:struct.pack_into('<i',code,at,labels[name]+delta-5)
    if len(code)>4096:raise ValueError('owned payload page overflow')
    return bytes(code),labels,roles

def build():
    body,labels,roles=payload();image=bytearray(8192);image[:2]=b'LE';struct.pack_into('<HH',image,8,2,0)
    struct.pack_into('<I',image,0x14,1);struct.pack_into('<IIII',image,0x18,1,0,2,4080)
    struct.pack_into('<II',image,0x28,4096,4096);struct.pack_into('<I',image,0x30,8)
    struct.pack_into('<II',image,0x40,0xa8,2);struct.pack_into('<I',image,0x48,0xd8)
    struct.pack_into('<II',image,0x68,0xdc,0xe4);struct.pack_into('<I',image,0x80,4096)
    struct.pack_into('<IIIIII',image,0xa8,4096,0x10000,0x2007,1,1,0);struct.pack_into('<IIIIII',image,0xc0,4096,0x20000,0x2003,2,0,0)
    image[0xd8:0xdc]=b'\0\0\x01\0';image[4096:4096+len(body)]=body
    return bytes(image),{'schema':'bw.le-file.client.v1','bytes':8192,'payloadBytes':len(body),'sha256':hashlib.sha256(image).hexdigest(),'payloadSha256':hashlib.sha256(image[4096:]).hexdigest(),'labels':labels,'witnessRoles':roles,'windows':{name:body[labels[name]:labels[name]+6].hex() for name in roles},'cases':{k:v.hex() for k,v in CASES.items()}}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('metadata',type=Path);a=p.parse_args();raw,meta=build()
    with a.output.open('xb') as f:f.write(raw)
    with a.metadata.open('x') as f:json.dump(meta,f,sort_keys=True,indent=2);f.write('\n')
