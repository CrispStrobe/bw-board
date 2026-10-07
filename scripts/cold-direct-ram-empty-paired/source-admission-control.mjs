import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {inventory} from './source-admission.mjs';

const root=mkdtempSync(resolve(process.cwd(),'.source-admission-control-'));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
try{
 git('init','-q');git('config','user.email','control@example.invalid');git('config','user.name','Control');
 writeFileSync(resolve(root,'role.txt'),'qualified bytes\n');git('add','role.txt');git('commit','-qm','Control');
 let head=git('rev-parse','HEAD');
 assert.deepEqual(Object.keys(inventory(root,head,['role.txt'])),['role.txt']);
 writeFileSync(resolve(root,'role.txt'),'tampered bytes\n');
 assert.throws(()=>inventory(root,head,['role.txt']),/clean source checkout/);
 git('checkout','--','role.txt');
 assert.throws(()=>inventory(root,'0'.repeat(40),['role.txt']),/exact source head/);
 symlinkSync('role.txt',resolve(root,'link.txt'));git('add','link.txt');git('commit','-qm','Symlink');
 head=git('rev-parse','HEAD');
 assert.throws(()=>inventory(root,head,['link.txt']),/ordinary source/);
 console.log('source admission controls PASS: exact Git bytes/head and symlink denial');
}finally{rmSync(root,{recursive:true,force:true});}
