#!/usr/bin/env python3
"""Authored LE32 keyboard client; no MZ stub or extender implementation bytes."""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def payload():
    code = bytearray(); labels = {}; rel = []; ptr = []
    def emit(raw): code.extend(raw)
    def label(name): labels[name] = len(code)
    def jump(op, name):
        emit(op); rel.append((len(code), name)); emit(b'\0'*4)
    def address(reg, name):
        emit(bytes([0x8d, reg])); ptr.append((len(code), name)); emit(b'\0'*4)
    emit(b'\xe8\0\0\0\0\x5d')  # call/pop EBP, preserved DOS ABI anchor
    address(0x95, 'ready'); emit(b'\xb4\x09\xcd\x21')
    label('read'); emit(b'\xb4\x08\xcd\x21')  # unredirected stdin, no echo
    label('consumed'); emit(b'\x0f\xb6\xc0')
    emit(b'\x83\xf8\x61'); jump(b'\x0f\x82', 'fail')
    emit(b'\x83\xf8\x62'); jump(b'\x0f\x87', 'fail')
    address(0xb5, 'result'); emit(b'\x88\x06')  # ESI result, key
    emit(b'\x69\xc0\x01\x01\x01\x01\x35\x5a\x5a\x5a\x5a')
    label('computed'); emit(b'\x89\x46\x01')
    # RESULT.BIN is client-owned storage, never redirected readiness.
    address(0x95, 'filename'); emit(b'\x31\xc9\xb8\x00\x3c\x00\x00\xcd\x21')
    jump(b'\x0f\x82','fail'); emit(b'\x0f\xb7\xd8')  # EBX handle
    address(0x95, 'result'); emit(b'\xb9\x05\x00\x00\x00\xb4\x40\xcd\x21')
    jump(b'\x0f\x82','close_fail'); emit(b'\x83\xf8\x05'); jump(b'\x0f\x85','close_fail')
    emit(b'\xb4\x3e\xcd\x21'); jump(b'\x0f\x82','fail')
    label('closed'); address(0x95,'done'); emit(b'\xb4\x09\xcd\x21')
    emit(b'\xb8\x00\x4c\x00\x00'); label('exit'); emit(b'\xcd\x21')
    label('close_fail'); emit(b'\xb4\x3e\xcd\x21')  # retain failure regardless close outcome
    label('fail'); address(0x95,'bad'); emit(b'\xb4\x09\xcd\x21\xb8\x01\x4c\x00\x00\xcd\x21')
    for name, data in [('ready',b'BW-LE-INPUT-READY\r\n$'),('done',b'BW-LE-INPUT-CLOSED\r\n$'),
                       ('bad',b'BW-LE-INPUT-FAIL\r\n$'),('filename',b'C:\\RESULT.BIN\0'),('result',b'\0'*5)]:
        label(name); emit(data)
    for at,name in rel: struct.pack_into('<i',code,at,labels[name]-at-4)
    for at,name in ptr: struct.pack_into('<i',code,at,labels[name]-5)
    return bytes(code), labels


def build():
    body, labels = payload(); image=bytearray(8192)
    image[:2]=b'LE'; struct.pack_into('<HH',image,8,2,0)
    struct.pack_into('<I',image,0x14,1); struct.pack_into('<IIII',image,0x18,1,0,2,4080)
    struct.pack_into('<II',image,0x28,4096,4096); struct.pack_into('<I',image,0x30,8)
    struct.pack_into('<II',image,0x40,0xa8,2); struct.pack_into('<I',image,0x48,0xd8)
    struct.pack_into('<II',image,0x68,0xdc,0xe4); struct.pack_into('<I',image,0x80,4096)
    # Code/data object writable for the checked five-byte result; independent RW stack.
    struct.pack_into('<IIIIII',image,0xa8,4096,0x10000,0x2007,1,1,0)
    struct.pack_into('<IIIIII',image,0xc0,4096,0x20000,0x2003,2,0,0)
    image[0xd8:0xdc]=b'\0\0\x01\0'; image[4096:4096+len(body)]=body
    return bytes(image), {'schema':'bw.le-key.client.v1','labels':labels,'codeBytes':labels['ready'],
        'payloadBytes':len(body),'bytes':8192,'sha256':hashlib.sha256(image).hexdigest(),
        'results':{'a':'613b3b3b3b','b':'6238383838'}}

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('output',type=Path); p.add_argument('metadata',type=Path); a=p.parse_args()
    raw,meta=build()
    with a.output.open('xb') as f: f.write(raw)
    with a.metadata.open('x') as f: json.dump(meta,f,sort_keys=True,indent=2); f.write('\n')
