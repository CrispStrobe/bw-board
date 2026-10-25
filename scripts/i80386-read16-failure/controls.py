"""Public synthetic controls for the failure-only reader. No original inputs."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import struct
import types
import unittest
import warnings
import zipfile
import zlib

OLD_SOURCE_B85='c-o~rYg60Evfud?+I$&12){4}oM`I;A)B0&1P-vfb;{S}lBF@$B1<|NiO1&h-*0!%LnGNH<lfz?AkCwvr@N=0Bfoj`=JcuHdub9sIVU$x&i$}Iaxy>4dFZ5hbQ>jpOwBy+IG<Npnis-JQYXvPunc(KUGg~Nx#+xk^JXWaerN6rJ{sz`r7xCoG}o_xi8RsAE5BIoEb?>(D;7A&Q5~1qp`LTDpG4soktm`-?ChMKTzZ4v@nQd9uyb|s=k@IR(}~A=^ImXtFgiZkKj<I(`vcw^F8aZ!ANKeAhx7U2pno)6%twoZgQLTvUax-~9?yf`!XFOj!EioUu$|MB>+{*C^OFxAgE@o2L2q%u7rhY=!sF4r$A>*WI3A4n(INDPM~h*9s3zT9ou2~+!=wG<@QBa(@NhId@P`L5s>cuggZ)9!ABN#^pZDhbob7zO_;4<<UW9z)59f=cuy-&TEDjG30AYU+j)M8|eAqt>hQWgOd$56E-t+x^e(Vp1ygxYL`$NFsi0zzReEoXy&1<pD5AOV1-a#remx&;cvO;vDqu&0}XwNV9fNzT^=G{f~Sd=;Mto{<~<D?kuNiq1Dp?R5fvZo)8lH&B^fkB!Sc^ZpX3>9ga2YfG2AH<f;*T-K0i@%<CRv`>5xF{N<(i|}4A&u@}zuJB0HY%3oy!(*mcZ(Pn+X%h$w2E1K=i=(a`PDUW<>VBmo}R!z)l==Yy>or`>HNd*U(UUv%wpb}v?7;1`1z{LnENeFxa+r_MVdR2>pM~6@T6Sv+%Gr+2Pp07?xZ!`&E5`nVd9GW0yqYH%k;d=r7hLxN(8q6rt$4*dnbr}A)G6|D1{%l{_x|HpXYg+x5pWD?1X&bB%Ft>d+c$65J3L+c*lYNBIrsBhkC}j9|>;YsBtu1Ed5sQKeWd=2T4n`%IHA*;9x{uoh5$^qg&uaOU?=WBu%0KAQ5ykw}ssAgykv|3L^o!V|K@%gm;tUE6;q`V44fyj0^vdS=;qvVCF3G6YrxR3*O#k|DCXQhbKWAa<yWaME@yyD=PR(sQu9b-uGvEK`O#BE)GCa(m**5|05bfKT!m_C2}kTe#15jj&oW29W_tjdFmkmny$7+U4#nkKyajs8~B;Rh2R%Y8MU{aNH}v)?ZWYs(CNL8c|z^)J(%ILd0Hl+t>S4c$f30y5i(BwP|!;0{4X99Gn8;KTc+uqCkf&bGBY@<pr4b%i~ZF+^qtwbH6xPDaI>v;yHhOTbhb4A8L)2=C9p^5AJ-S(Si3E$%pd)rP@H=Jcsz7L1@N^^O0MHJ=~WJG)7V``ZE80lgZ2oV5k^7LV2t2u(YEK|a|7NY;&G_yW0>vU<KE=Z4zat{9$Ooj+)dqk1){@t@8onIZ$K#q!`46vS*B6K=LSm9bXzPNDEaOjQTjW|Y9!QHLARu)LPYR!b#y(?qBkr+jZAVy?q9)7{1q39E1MXC<R!6d5|t))1PDBw;&s~MLh6jGGrbAAC~^W07HLt&G58R{vc)F7y<>lGG5tOoJ~LO2b{UvgP#_9)mWrr|?iDONIWO!XN(yyys7)RlNjj+u(8;MFy&#?%--?~@z2Vzd3uf&O+THFx;3+*O&}o@Ig8qXi8$0vSFyy3$<ZAG56oS4WZPtEgM8%wLTCJL_bQmd71qj%ow2#rEY62)Ab^2laj#SQMS!ZZjrIN08s`a+#X%`HvE)Cy50Ou}=7Qjm<ixLD2^Sw%M^+)?hL%CNaTQ~qLqJt(;0&&3pfm~Qygdr1l!lvp($oErv-#@U{4tOF;eOzh!B%$+>;OQ`6P&b&DNizM#GZ5iz>Uk3;@}SEf!NZMKJSqHG*?aIY*wkg@H=kYpu80KEyI6oTT-T!rQ<5_0pf5qXD>BN1SCM6OaIim8J8oJy&%+TG%LI=>BlA$hWi@&#4vS#PS3V3O@lW$7X9=!~Q{<cz&p+WCKHOl7_G_qBzg*$rfunXMmr<KN&HW@;I<Y_JvBU3yI^W=UJAMIrFw=vsVDHyt#hoBst<vNpIG@5mmR-Q``VMRrsy2Yso<DSIZq}Zf)w%CiARIM*1Eh)u2<<G7M0O4S<(zlt4}0^}&qD%Z2DNRoPF9Q|?a*TcTEQQiT5L^^kP&~4${O~x%2HEsZ1w&NL>27qu;((`jRS^+KW*5a<|b^;L@`pe5X<2ptqn(>>){x`sNu9dxk6oOPM9SJFtOiz`}P=QObg=W)h4=Ia<q-`-Pb$T|CRHF=pr6nwhNTqh#5F=UGQUXkxTrM2W1f@w?^!M5sQtYW(hW88v6<FZix!^RKzjp4MzRmV8|>oC~Yv8fHo{dhXz-8Z0>N6WEmWOP+Jf3aBTu$&Km;3ozL_Ma%G?Lfa)w)XA>FcvIY2Yg+8v^sZpI^m{zHIRB8@9**ew|eP*3@Hr?VCG)GA%LB_IR6oWVwKukGC(bPJVfPrzN8<0BGh|XB$92p}6GERQ6(7H!009`;YBk%A!kt2~@`w)H)%uo^ijkHz13XN3IrZ0%Uq2eZ#CqENfPOJ4QCFJ~-qM=<67-YD#jN*_?3>Z}xxwpjv?GFw|M=ux>n67vsRk?u1q=*7!Yngom<0QbzNJ8PLbC)Jx(zMng<J#+jXZra=%Eh;|IKy~9nwJH?Nx!NX_PW5>C|f=Ww0S^}n`i}R`3$_EImW4|j%jm0X*+0+v>fzk>_+3r<SUqtG^58xuSEzLMa~0^ni`PGAK9oBD<Z(u!9lMF3O)qQm<oR$b48fug0CYN0HjctEpjfFj!p+q0&PtxyhPfmOW`mwKh5|igV^MHrEk~x&f1Lt=Ot5FHFqKb2Mr?z<&cAGZqIt}je6$4Dzde#r0_Jml&rGpJ0;t~$n{->s)=MWSo&Z&;BQu*Jq0A>B!to8JVD-s7#;9DFS9~G1RX*Eoj+ak0&NWFIes4noKj_axf<P6NQUJ5t_5_A@>yl)Y~e(_px;N$PUx|5U++~R%ElwpqEWU+Nv@B-Gyf4rf`d5(Dyc_snxl-3d!$A})%FaHdaG=#B%s<d4R3B6;TK@<MC>E$&wSVz8%rq+A>zH~`A5Huakgv(OfThbVRxVkGnhAzAToSn&(DouS`epoI)M3Qu}t$ik3$dqc1?Q2UKqRrOrnG<MuvP|z(0N%L!0Ag5Q_5fEKY+v0dY$4F^A;<eSAIxL4qw~dmx;=2%O;7M+Rz7QLnb0yS23~E+H0dd;mrTpCvNDun~3Ekb+Ui$HUQauSt@yMiN7Yg%`q!t~LUssE*pAO=lK3>4L%V3wfY02@hvX=3;ORHu`hXTI}^YgVEq{uzxr_J{}z$4u^2q`h4%$V!`EStQrJmo<p3;Yl=={qR9xlWC9d{@RQ^xe~^DTCYb0kkR54R&|gq=mh>gy;t(V)KDQ*(x6efPTiRD2yqaDcly8~9Il9gL)k-3`j#Z%0iSnEli-h{Sl7H{Pk4y7Y@P%b_Qk(?n6)1e3r*8)+S>g^B`1}#pIBTu}@&ZeIX94p5a!HUBE5Tuda54pdNVWGd?SC*La@<C6$n#S+9#n5<AUZ=hlvg)rPR5gvTv>1yfK-k;TZqTiznVyZz*a~I3xNd?hbwvx2I%OD;ty~dKx%Nuu-4gcCrxNZ^a&(5FCZvbJt7i;^I5_Z&{U?4#{ENRHB*Rd&r_*w!;%yWE~5uHrzbaCeHZDIr7C^mmLRB@bObNgB}F;QqR^uxIVcr+P?o0dz~DTvg{wJ8<1)&ebS`)fw7ZNz-WMeQPfiRbu)s4PqOuSHkQ<H|JU;=|KUfV}3T`(VNv8lg5NC7(2tI_4=jeh9iY8Sop!cxJ6+py*sI)JZJ|qB>ni__>LLD8Nu6P33San1UN(dq$dv<V}r)9QjDQnLFL=q9RAcl@;gOP%i9ITpMGjn4&LqwBuk(Hel8X6|;k0bvuEJ`3{Oy?nJmHrXMO{zyc_?ha)@yG)8IvO&N6`sIZ4`6$0If;m`jk{)HP38F}xoUE7KExS)dXpn2y=g7uhYi1aJsE_ZUH)FBkzsE*5cBs)B9l{vb`We#epJKjE*5MB6^^9$^aX-rtpc-EP4S+#(K!S~TVUlCtd6MXxN6H;ato`%PLdQHE`hR2f+3oc)f8?si#oPUG6z70lht{UGH8q7T6Ab18CEC1Nt0@_fz8=C3;e!e<?dl$gCt&cZmJ_`3r8bcjrRHxgYR@D|DD}Mam=3IQ&`HCVT@z7lN#3dp4TH&L=^#U0?;;*QDOj`1HOSH-o3c^Dl=w{OrbCJonMCF?&{LajLJMQ_meWCXBFwwGeMD0j~OK&>Z(t-8aKB}{=F*ImzT-s5F*Pt{OjjMv;YD4Y!Z$tvqwm%XN`5^^^`(xwF{jPly9=D9wbB1p9FC!A}ZwaM=*j|q>{Vw*Yv2~<%<EIHCcMr25c>3sQoygDYA0XVtNnEwOP`3TTJbM+3aagt0+e$2n>1vcbDljfIdz-iSBM5=F%ILM9m4*>Hfx)Q<bfdGwh0<$!b)TBA%)gULV4M6x3%B0X3k*&Vy7lD*kVprh9e1zM5z8a;k#HGC&muJXrWq3@3uMElAe*ruwLWl3=oW%(&LOF?3vq@qTSH&{GpI;!$<%EW)$eQ9!|KX65UwLrCV(+HkBxRD&Y3c@l=w760)}A;H4w9gS3(oJuc%2j3s6N=ue|)X}*Gh1N(Let&Mio2TKEm*uh>UjXfupWpG^W2b-4@XkbkG`l?ce0BZ--v0Ib`Ss0A)z})G!r5!(FKje5bqw6G+9AtT*b{&^yh!7))$Ro7o3`ZIR=Y9Xm`R7g7`1WE-v6?<=llRauVq&V+s@wJugoPRJ#W%v?^GpG_ZE5jH^+QmavO8QP=M%2)D%mWhG?=rK(qv;D_WwTkIfa8EJmnM4KR_3VKAwce`1YGN^}5OyJmT)f1>-Q9?C`|8D0U?_-urf<u8M=gi@hd<@=jkvZ^S!ZP|#mj~Uj0ajOL1uE^NCvD?*Lun&yTr3kDVEV~7GE`WEnR-E2OlB8C-fk_8Bcku230F)5yEocI%Oc_j1A>v|+KC+MM3Sko&WU=1+f@VT|2nL3&^=9d-Y2woI=ur^_8`Gsibm^O!Bz%&N%Ni=wTQ6?ZNBsm!a-wW|i8+lSME6(lN0zv7!?I?zQMzPVqykn$R@GM4g`PTu5_%I7h;r3>d;tvl1CMC7@OUT?SgPpD0HJ;)ezIif)=Fb;?YOzkx`EF8Aa<1dv5o)Ka%Zfpn4R3O`IBcSms_jMwSiW-+4w;(mYE6rQ+c0(Sf-v;91NDVh#*qJt9^j6jDx_TceE$qvc@{EP3Y@s(z!Din>Lh#?aLd+fJ-z1vMj;Zylhij#uev&aA(YU9h9|S%;`(ZYx(G^G*>~91|4rk*taa|Kvm&uI-#1Ifi5plY%SYSFm7j;>%@|SB&kS1$Cd_B!YZ2zSt72g%i~6InQF*mtAuQ!IevK$wGx<Iu2vMIEFkvK)ev(YB(U*!8}r(^n!2R<>OHFZj2UO?C~sKsXRC0!K1fj2Ijyg%J-X*-eLbc7TU6M!I>mWV<R1DVjq_O1ZWFK7X(DDP;8p#>bMl+VY%u5y_B;E`rFOO9{$O}CI6NNoWUEG4-$a(Jc=s9rbknTpE>p}J6lod<n9%QHe^-I-K8}Xnd6ZBiGnY>BnhZ>TSf;VcAAuSKf1a|I5CLO#=$-T6N5#-71<!Y79!sa9F+J!2L(&4N0OK$Mcg;p64Fb=UP)Una3ICw3VQX=%k2&47i!fU+wp3SI?D)1G`O5HEUwMJZ$&ra0Oes<d&owAE0<i#`D?Jo-#oM?0m_(5Yxy#QVK*Jya4~}l*f&klHi(q!yUcZCsxd;Tsl9B+#qINJgpB4LrY&<hWIbdqtR9jxbc-w874Z6iPa^sC&rtPSVH~22Db^T$y@%Dq3>_)WJ2-e1HVVxrAc#XoYxjQiiHerYi3ll$>YcX=%V5>~+j`82;dW37q#QNO{WfN6+TgzUq4*^%?2(}&FE(?x!luEv)Ux^)F+V#Faztc%l%96js1REu{tXma4Nb}IDVwtO?_M)!7uD;=hg#-W|InXu1%r_P}2m^U{pa|2_I0XfG?YVj>g@21dmQr}gEd<rPbZgzPM%-FvCFBGZR9s>WQx*Hh6<7&W`b-F?DoNOm6DelG)Kk`2&0{wHKnQtV;+@>chOuUQF!rc_JgC6S8yOOut7pjT26R0`CkzONJ7*}{Ab?MbXck#YPfsTjR@$(nEIKFyEW?FJTR+2GDQMF0qAW=NUaLzPQVr|3AS<uUZH+kA&ny4&>iYVh(Wz#myh$UsNzYjxL1+v}(hMKtKZR9=uTg>}<#;RgC(VV_esn7I0DWhk$})HqbjL4V^Tb*5uOLw&!4E5FYXT)5b&DEUYq#mas9s&YSTwP3HPlaYsc$v>sODN)*Z$PYuRSah7}T~eF3SdLlGkgaD?*p*3%bi;QC&H#6C2pnEhn{oPj{iAzI8MZmNBQ>uI0+&kc|&!<$Ib#_CnaM8Ei`4?VU|jV@ApvrGegiuipFK>-UC72Ztk<L6bwZfEU!occxE*sy*Xr&;@0EC``%Ol5jRg)hip?F0<sF04bRVM+$3@tP=h4WZJCTm$v4S<Y=g!+?-~k3eADe!R6+#Ev`K&$6r9yryUpSQm%<?I>GMBS;0-#MyWPyn7I#yE~;Q#&dU0N=GL|i%P3vB>&n%2Yg?{?-hd`E4&V#GjTc)3Ey?AX5;6qwvPl<Q8~Ot)$l6F&P~a?@3bCr!jg2Xl@EY1pE~U7%Wi6xr%!2Ri$;8^9MN`X;w1iVkL+Ovf#^eQnp9tc+z`HocPLa8sVm@V3GelFbR9_<iPQsfIfJro!_vLHnyIb|0Hv8oFWpwl2Pi}eZustQPs5oj+X=Y8GbQ??7I=8{a&(e74RiBG?;Alra)=Y38?O(lqr?)Q^aa6U+%<}pyLKAPkbb5pJ5KQMSru3N}vOq2`74vt+h_Sq|LP|$afF_C@3y<nk+l=S1nU#+Y6ON>G2=MG#-gLnNp${4}+*0<kODwJ_uQZWiR*prxq6B@d;zIQ-l{d0Wk1{u6r+=uoO8?a2A-ZreSLZl=IDf3YUfYgft+{duMUiGS4Ii%So+C9_L-h)x30pLw%Igs)b0L#4E1)cx%1iVuWSRUoDtJ2_zj8#23$R24{*$ivwRbj~m+ko$HB)`5@TwrA3LQWrTNrDDRYM$24TSF&_OeB7VS^zejB3V6qG+2Vy+iz{NY+A|d|>XdcRa#cXp<q#9e{17o(BD^p3PiW{nN4XrY%hIORGlABzsw1%o>ivmN6dQ@=*2^(WkR-?hk<SU10{%{=AcJ4FV-<n6b?=4g4h9n2)aHhi?d?b~F9Xz4x$DeHX_(=Ju6yb*KGajSEQyL_5wVtl#NTle?*Rzf=3PQFlSK_?>-8eRWURW%6E|emj#NT$2RB>lGJZCg9;5jM!I@Hgu?~w=<de(XZDM56spmZDsIwRC1#J9i?QVM!L3$Dirsai(h!ujbB@O%GJag)@ml(d_$^jAt&#t7!+aIu6=36D9`4tWwUNYN3|&4Wu%M%ux)Q4z0n4)Hoeh0L#w=5_~M>mU~_=t4R#rQUmwxn3y$n<8$+zDh|c<0kymgRWyL>3EiCn$n>P3z=_`nY^-W2k9}q<uzwJ9lKYkBS)hqVge|gU|!c|L3bNJ$BQJZ=7^DlmM^55zF%bFs=ss9hXKyZyx&}Pag1nE4jYXfTkIaOdE&SzN;CE!00Xf<eyG^^g)!6zwo4H)S}G%6-*+Fz{ceV5uO^<jSuPBZIMm5Z_2WK_L)!OQNjt%$vuS1E<I12XV`MC0IR(Ey5COS=TDOVp{^J9P)`B`-$(a0fXt`s0R6(vjLJvHV!wA(bfB2hf{7yZrq+115kRjJG=IFc>_WRk^Z9TdukW_9uAeSJ<=(mUP=GaYJLU;6s0921U2gFqs3FSJBzY?>C<=@CM1n)rZgDPOknvJGq&C{QSrH?Ba6P|7rr=PwTmD*>SU8J=6a7)mGO}kN5}O%Nnm=)G{MZs(V=DEw{7G*soyhLcj1&%3{fpU36hnr#SpD%`n>hSLw$QnC7Y{K!-+Be!WwFF?4nFxZa7k2QIFg?a%UNBYLb_$EhFn@$*}XGi2oE>DSIlep_NK=@Q>^)S;NeoB67_#rF29i+PyDM+sHm#IFxEH}!rv(o_<DI8t67dBr%zqqU*Fmv!WiXTWfwlJN37aX)O~Pa;`AEntxhL>R@rN}q&YDmr*mL{5U2i`mtOi*H~4{Xg{l?c(FbmoFE8>bGyFUoOu6S>+9i{HdPA6bNvEi?kM@GCKIyxt@K#zB>P{B|4&*;l~`(zoFLztks>qpw)X%ZTO|6`pFUf#gL<~>`H9{sxB)FE6-$p{(!Ms+rttpv{U<~gF4cb?!m8S5P2fuB6Lw}P}GW~-0kn_`R(@FT=io$1Y$e~0C#IcVCJqz18QAGgIqqSAZ(%*V#y+<AD9tOD<qOozcNz;LQaPM^_2T@>mKPB@_Uyaq9m0MNKyHO<d;uGdDVznvRNY9>q%+7b<Z=bAy(1CE%XQEQ(>NHBW<kWQ584C?@jV(QPh7WqACEvS&W~?uyOiy7ipoc9pb%9>vwtN1!rQB-_fU-?xeV?QJvT7G6uD(v)O2+b7*c`s4rPnm%jc?r5E{cyYYiSAPK<v8QplA&A?dBW~ioSGcY-%u6F(xltInl'

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('read16_failure',HERE/'reader.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
ROWS_B85='c-rk)%aR<&4ZQO!7<=~EKs|se-K;-Bp-|+S+(+!}N@ghZ@6M(rUsz4*;@ey{hQpZY93YXIz;Ex~zrXwE-B0g-!wbB8HveQF;_v^uK0W^LUA#ZOyv7x8q%Qq$f4+JBXsHU`y<4kuP>`xi<nCdmuj;%=6L-nFA~dZ;VxlCavo;f>K5OJ?e)sh&fB)|{-(6q)A2yvDbpYAHkR-Z+(Nj+{+n6PDUDmQraSt7yRf$XMLX#UeN-=60R%bUO&QX^XTN@a!mqsOBEYS&+<LB`PiwhNRmNZc=)~!**$Ydkf>l7Q*V}y8P8F^(_ZB5IP(XHce+hTdXrpv?A+ci$Wq}F#>hSt?{WGh8;B(BnImE5M()(Zz7sg!Nxj3Vi1tCTWq0DMc0!?swiU#_q5aPg<d*O#ZyXMm)o4Ir}!pX@yh9b0AQS{hrC5gDBztyz?7VgRn9O-jjBn7BD!g>C@7&HJazc)OmpiE5`EWvV5~BbA(1%hZR0qQz*)^hI;J^PIvKHilZ$q?PK*0Fh)EZQA4??Bez^Pk|JcT}jpuF6_}tqFN;y+Tv?1m6B4bv&gCy6EhN(+Q*bN(V{kKR9bU0LjLjo`SLmDhj=+1Bi@bC;50zdT&am<S+x2pR0CxZ(6yI5v^ZtwLHKVUGp`kmGjN;d4PB;TnsYjVQCn#n7>&`E(H(RY#zWG=91YOMJf?xpA|$C529YZ0Q7GK!Xg<P1+lD0Z{nkjWJF?c%@ypbYe=oIzi86{RV>~3`k2e~lx6%W6YHH3th4RwK09`jY{{0*;_Yd*-YM(Jm#&SlMTyx$)0vRMAf&_7??)c@Cixe~=DKw_FGyw%PY2eHnt;bqWVHz|Nm~B6RbPs`Sa(RAvdJTV#vwCT6w4?IKK{RwsrhqM^*+J!`W7UG`PLxuI;P%y8n{%!L8CYcLsArN;`Z2l;bdaD21IHiZTzl$H4aMu?<lbQbhdsqCqaMJrqMb`TDsc1ylL*M6k{;$(TpC2w$6teYhAB7Hb_c3L7aR?W>?R97<z~HC7FeaHo-4{#eU#Pa5|*Tdaez2y_ElQ`0jOWV{D*jWdiiqJOEhICk0K0FoZh_F-c!-STBqT$&_^H;Fui|OOdl&vbX~eiumm{38=`%T7k~R4*Y6Et(Y_M|L<?I`fM_k|fWh_w(KgcQApdB_&`?7A)@(!uS1Ew%!Y~ts-G2)Py#kZIPb0=C@UAxMOBd)HGNV)`MXu<PQ{WRw6?iZtG?lQ`Mha@Rp_NC6y(|{>GdM5yaQXG=Wu97@RN2ZDTwrxA*)&gH$UL^7gB?)}jxm$PNHb3za8@`P7>;TRGC`h(nK*%SYGYcrRcT!Cs4m>f(os5f_+_e@mAi(6*8$q57AcolzVd?QvqCL9WR`3P1Cx0=<J5O3ESaJb1*+UaJA|5<z+ohvD%p@~965}~QHVr58scV3v%-qFB%50ll}}LgF1wj7$QE-YFqV3v&{;u|W?3pCFIAf`aD?27GH?v&Bt~14!O#k(f6v!c%UMTS-6{*JAYUIKNBac@A;jd22Vtng^>9pZb$|>7xwJLc%sdV<Tk}kN6!io}OTBJD<bq;gAXMm}1LDl6$T^uuRE8rRjQmQ{5qgBc42Nhn8={RM0<ArWewxXt?`#uvb1Sf08ptWo&7sK=YB;+<c9oJ(ED*@7iQr(S)d&U~tLZ$#@V6-bkdBLg4FB}}bpQBzT9>wqpA~WQ2z)R<Yk^p^S_c*9T1kDt4V!6bcI0|VkxD{j9}U#?ys)?Q4I)Ppz>0IKW=J`^(g^$pn?U!3yyrQg9tgahGwh}nqztTc*<m>{4>;CFMe>+4QXv2M4hTMXMiWfqHfv?_EFIFd5NfcENWv3j9*cp&I{nDR1Af;Ll^NN6un3kX0$3pIeGjA3>AqCU21WFy4(ZO=P7ES;q%fE<w%o(x4Dp4KzX{tN+z=RDk(XBtq*Se~ZBRVM!KkxhXxZuqIMEf{YoumNk$wv@-Nd4Vy05`V09gy9q#GndGGZ4v+p!#|aVlj4<H}I_({kWZWjnmbcY7Xiu1QBWLau~*MGXiAatRjuxh6I!$H1U9<&cw!rA>Gh-ssq~U#`z#pUyWEsMc;=C>_aY5?nRr1TV4AR!@VYq-B;C59B)Jp$xg3NR_5D<zx9q@pkmMj?270pT=*jpSx5<uvf+?W+a_%SR0UpXTnAZTWj^mMI#~KDqH3bS3z21PYenaxFUZG<L!B>oDB;eLpwPes5a;iThWMIu_qB`6zW9`C2b?%z8Du+3qeRHgq`73$6lS6BeQ%9<Ch=puCkrlgO#d^B{^zksJ0toe_&CZ9NesqjD}3g$U}1`W#Bz@ANCUX<fa~99x_708H`HXE0k+H8sB0K>}UugIdsA0Iz-e~#jH581`$XCdx3rpLw-G^w=%f$XFcBi0p;%J+g<E-7rWiXZg;WUUF>!jyWPe9&v&uDjanW^&Y-#|^e9H-4jL2Oe5pdB!8qUq;R7{4)+Il7%9<1UiMH={=-XZFb{D(d#cp@8+g<E-7rWiXZg;WUUF>!jyWPe9;$7_B@9+Ktf1`zO'

def synthetic():
    rows_raw=zlib.decompress(base64.b85decode(ROWS_B85))
    assert r.sha(rows_raw)==r.ROWS_SHA
    rows=json.loads(rows_raw)
    common={p:{'bytes':1,'sha256':'1'*64} for p in r.COMMON}
    common['scripts/i80386-read16-paired/reader.py']={'bytes':19750,'sha256':r.OLD_READER_SHA}
    req={'schema':'bw.read16-paired-request.v1','repository':'CrispStrobe/bw-board','head':r.OLD_HEAD,'tree':r.OLD_TREE,'baseHead':r.BASE_HEAD,'baseTree':r.BASE_TREE,'workflowHead':r.OLD_WORKFLOW_HEAD,'workflowRef':'CrispStrobe/bw-board/.github/workflows/i80386-read16-paired.yml@refs/pull/679/merge','pullRequest':679,'sourceBranch':'lane/386-read16-ordered-pair-source-20261024','label':'x86-read16-paired-v1','eventName':'pull_request','attempt':1,'sourceRowsSha256':r.ROWS_SHA,'commonFiles':common,'workflowSha256':'1'*64}
    request_raw=r.canonical(req)
    event={'action':'labeled','number':679,'repository':{'full_name':'CrispStrobe/bw-board','fork':False},'sender':{'login':'CrispStrobe'},'label':{'name':'x86-read16-paired-v1'},'pull_request':{'number':679,'body':'<!-- BW_READ16_PAIRED_REQUEST_SHA256='+r.sha(request_raw)+' -->','state':'open','merged':False,'labels':[{'name':'x86-read16-paired-v1'}],'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}},'head':{'sha':r.OLD_HEAD,'ref':req['sourceBranch'],'repo':{'full_name':'CrispStrobe/bw-board','fork':False,'owner':{'login':'CrispStrobe'}}}}}
    event_raw=r.canonical(event)
    source={'schema':'bw.read16-paired-source.v1','head':r.OLD_HEAD,'tree':r.OLD_TREE,'baseHead':r.BASE_HEAD,'baseTree':r.BASE_TREE,'rowsBase64':base64.b64encode(rows_raw).decode(),'commonFiles':common,'arms':rows,'workflowSource':{'head':r.OLD_WORKFLOW_HEAD,'ref':req['workflowRef'],'fileBytes':1,'fileSha256':'1'*64}}
    source_sha=r.sha(r.canonical(source))
    runtime={'nodeVersion':'22.23.3','nodeBytes':124827920,'nodeSha256':r.NODE_SHA,'nodePath':'/opt/hostedtoolcache/node/22.23.3/x64/bin/node','measurement':'whole child including preexec; wait4 user+system and matched monotonic wall'}
    unit='bw-read16-paired-12345-1.service'; parent=1000
    context={'workflowHead':r.OLD_WORKFLOW_HEAD,'workflowRef':req['workflowRef'],'actor':'CrispStrobe','repository':'CrispStrobe/bw-board','head':r.OLD_HEAD,'pullRequest':679,'sourceBranch':req['sourceBranch'],'eventName':'pull_request','eventSha256':r.sha(event_raw),'requestSha256':r.sha(request_raw),'runId':'12345','attempt':1,'job':'paired','parentPid':parent,'unit':unit}
    device={'machineCycles':6000000,'debt':5310,'deadline':16000,'appliedClocks':5994690,'pitFraction':0.262723749965744,'pitCounters':[{'mode':0,'rw':0,'reload':0,'ce':0,'out':0,'armed':False,'nullCount':True,'gate':g} for g in (1,1,0)],'pics':[{'irr':0,'isr':0,'imr':0,'vectorBase':0,'intActive':False}]*2,'rtc':{'cyclePhase':5994690,'periodicPhase':10562560,'registerB':2,'registerC':64},'cga':{'cycles':5994690,'frameCount':22,'lastVretrace':0},'keyboard':{'commandByte':0,'queue':[{'value':170,'keyboard':True}],'scheduled':0}}
    semantic={'schema':'bw.at-profile-child.v1','kind':'at','steps':1000000,'charges':6000000,'cpuCycles':1000000,'state':{'ax':65534,'bx':65535,'ip':0,'word':65535},'ifEnabled':False,'interrupts':0,'ordinarySettings':{'translationCache':True,'deliverFaults':True,'cpuProfile':'compatibility'},'devices':device}
    def position(pid=None):
        return {'unit':unit,'membership':'/system.slice/'+unit,'observerPid':parent if pid is None else pid,'affinity':[0],'limits':{'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','pids.max':'64'},'pids':[parent] if pid is None else [parent,pid],'descendants':0,'dyingDescendants':0,'populated':1,'tasksCurrent':1 if pid is None else 2,'memoryEvents':{'max':0,'oom':0,'oom_kill':0}}
    children=[]
    for seq,phase,pair,arm in r.SCHEDULE:
        child={'schema':'bw.read16-paired-child.v1','arm':arm,'sourceFiles':rows[arm],'semantic':semantic,'setupNanoseconds':'1000000','executionLoopNanoseconds':'1000000','warmupSteps':25000,'warmupDoesNotContributeToMeasuredState':True,'physical386TimingCalibrated':False}
        stdout=r.canonical(child);pid=2000+seq
        cpu=1.0 if arm=='B' else (0.99 if pair==0 else 1.05)
        usage={'pid':pid,'exitCode':0,'reaped':True,'timedOut':False,'userSeconds':cpu,'systemSeconds':0.0,'cpuSeconds':cpu,'wallSeconds':2.0,'maxRSSKiB':1024,'stdoutBytes':len(stdout),'stderrBytes':0,'primary':None,'secondary':[]}
        resource={'before':position(),'preexec':position(pid),'after':position(),'sourceBeforeSha256':source_sha,'sourceAfterSha256':source_sha,'runtimeBeforeSha256':r.NODE_SHA,'runtimeAfterSha256':r.NODE_SHA}
        children.append({'sequence':seq,'phase':phase,'pair':pair,'arm':arm,'stdoutBase64':base64.b64encode(stdout).decode(),'stderrBase64':'','usage':usage,'resource':resource})
    original={'schema':'bw.read16-paired-original.v1','requestBase64':base64.b64encode(request_raw).decode(),'eventBase64':base64.b64encode(event_raw).decode(),'source':source,'runtime':runtime,'context':context,'children':children,'failure':{'phase':'gate','reason':'strict paired performance gate failed'}}
    before='Result=exit-code\nExecMainPID=1000\nExecMainCode=1\nExecMainStatus=1\nControlGroup=\nLoadState=loaded\nActiveState=failed\n'
    after='ExecMainPID=1000\nControlGroup=\nLoadState=loaded\nActiveState=failed\n'
    cleanup={'schema':'bw.read16-paired-cleanup.v1','runId':'12345','attempt':1,'unit':unit,'beforeShowExit':0,'beforeShowStdoutBase64':base64.b64encode(before.encode()).decode(),'beforeShowStderrBase64':'','stopExit':0,'stopStdoutBase64':'','stopStderrBase64':'','showExit':0,'showStdoutBase64':base64.b64encode(after.encode()).decode(),'showStderrBase64':'','cgroupAbsent':True,'remainingPids':[],'nestedGroups':[],'errors':[]}
    original_raw=r.canonical(original);cleanup_raw=r.canonical(cleanup)
    expected={'schema':'bw.read16-paired-expectation.v1','head':r.OLD_HEAD,'tree':r.OLD_TREE,'workflowHead':r.OLD_WORKFLOW_HEAD,'workflowRef':req['workflowRef'],'pullRequest':679,'runId':'12345','jobId':12,'artifactId':13,'requestSha256':r.sha(request_raw),'eventSha256':r.sha(event_raw),'originalSha256':r.sha(original_raw),'originalBytes':len(original_raw),'cleanupSha256':r.sha(cleanup_raw),'cleanupBytes':len(cleanup_raw),'workflowSha256':'1'*64,'conclusion':'failure'}
    return original,cleanup,req,event,expected

def encoded(packet):
    original,cleanup,req,event,expected=packet
    return r.canonical(original),r.canonical(cleanup),r.canonical(req),r.canonical(event),expected

def synthetic_official(packet):
    original,cleanup,request,event,expected=encoded(packet)
    rid=12345;repo={'id':45,'full_name':'CrispStrobe/bw-board','fork':False}
    run={'id':rid,'run_attempt':1,'head_sha':r.OLD_HEAD,'head_branch':packet[2]['sourceBranch'],'event':'pull_request','status':'completed','conclusion':'failure','path':'.github/workflows/i80386-read16-paired.yml','actor':{'login':'CrispStrobe'},'triggering_actor':{'login':'CrispStrobe'},'repository':repo,'head_repository':repo,'pull_requests':[{'number':679,'head':{'sha':r.OLD_HEAD,'ref':packet[2]['sourceBranch']},'base':{'ref':'master'}}]}
    steps=[{'number':number,'name':name,'status':'completed','conclusion':conclusion} for number,name,conclusion in r.OFFICIAL_STEP_ROSTER]
    jobs={'total_count':2,'jobs':[{'id':12,'run_id':rid,'run_attempt':1,'head_sha':r.OLD_HEAD,'name':'paired','status':'completed','conclusion':'failure','steps':steps},{'id':14,'run_id':rid,'run_attempt':1,'head_sha':r.OLD_HEAD,'name':'source-controls','status':'completed','conclusion':'skipped','steps':[]}]}
    prefix='read16-paired-12345-1/'
    admission='read16-admission-12345-1/'
    members={prefix+'paired.original.json':original,prefix+'cleanup.original.json':cleanup,
             prefix+'request.original.json':request,prefix+'event.original.json':event,
             prefix+'source.original.json':r.canonical(packet[0]['source']),
             prefix+'runtime.original.json':r.canonical(packet[0]['runtime']),
             prefix+'context.original.json':r.canonical(packet[0]['context']),
             admission+'request.original.json':request,admission+'event.original.json':event}
    for index,record in enumerate(packet[0]['children']):
        stem=f'{index:02d}'
        members[prefix+stem+'-preexec.original.json']=r.canonical(record['resource']['preexec'])
        members[prefix+stem+'-stdout.original']=base64.b64decode(record['stdoutBase64'])
        members[prefix+stem+'-stderr.original']=base64.b64decode(record['stderrBase64'])
        members[prefix+'completed-'+stem+'.original.json']=r.canonical(record)
        members[prefix+'capture-'+stem+'.original.json']=r.canonical(record)
    for name in r.physical_roster('12345'):members.setdefault(name,b'x')
    class WriteOnly:
        def __init__(self):self.buffer=io.BytesIO();self.count=0
        def write(self,raw):self.buffer.write(raw);self.count+=len(raw);return len(raw)
        def tell(self):return self.count
        def flush(self):pass
    stream=WriteOnly()
    with zipfile.ZipFile(stream,'w') as z:
        for name,raw in sorted(members.items()):
            info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.create_system=3;info.create_version=45
            info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,raw)
    archive=stream.buffer.getvalue();log=b'synthetic bounded official job log\n'
    manifest={'expandedBytes':sum(map(len,members.values())),'files':[{'path':name,'bytes':len(raw),'sha256':r.sha(raw)} for name,raw in sorted(members.items())],'runtimeExecuted':False}
    artifacts={'total_count':1,'artifacts':[{'id':13,'name':'read16-paired-12345-1','size_in_bytes':len(archive),'digest':'sha256:'+r.sha(archive),'expired':False,'workflow_run':{'id':rid,'head_sha':r.OLD_HEAD,'head_branch':packet[2]['sourceBranch'],'repository_id':45,'head_repository_id':45}}]}
    raw={'run':r.canonical(run),'jobs':r.canonical(jobs),'artifacts':r.canonical(artifacts),'artifact':archive,'jobLog':log,'manifest':r.canonical(manifest),'original':original,'cleanup':cleanup,'request':request,'event':event}
    binding={'schema':'bw.read16-failed-attempt-binding.v1','auditorCommit':'a'*40,'auditorTree':'b'*40,'auditorFileSha256':'c'*64,'historicalReaderSha256':r.OLD_READER_SHA,'historicalHead':r.OLD_HEAD,'historicalTree':r.OLD_TREE,'historicalWorkflowHead':r.OLD_WORKFLOW_HEAD,'runId':'12345','jobId':12,'artifactId':13,'artifactBytes':len(archive),'artifactSha256':r.sha(archive),'jobLogBytes':len(log),'jobLogSha256':r.sha(log),'manifestBytes':len(raw['manifest']),'manifestSha256':r.sha(raw['manifest'])}
    for key in ('request','event','original','cleanup','run','jobs','artifacts'):binding[key+'Sha256']=r.sha(raw[key])
    return raw,binding,expected

def synthetic_bundle(packet):
    raw,binding,expected=synthetic_official(packet)
    old_raw=zlib.decompress(base64.b85decode(OLD_SOURCE_B85))
    binding['auditorFileSha256']=r.sha((HERE/'reader.py').read_bytes())
    return {**raw,'expected':r.canonical(expected),'binding':r.canonical(binding),
            'historicalReader':old_raw,'auditorSource':(HERE/'reader.py').read_bytes()}

def changed_archive(data,change):
    """Rehash all external archive rows so only the physical defect is tested."""
    with zipfile.ZipFile(io.BytesIO(data['artifact'])) as z:
        rows=[(i.filename,z.read(i),i.external_attr>>16) for i in z.infolist()]
    rows=change(rows)
    class WriteOnly:
        def __init__(self):self.buffer=io.BytesIO();self.count=0
        def write(self,raw):self.buffer.write(raw);self.count+=len(raw);return len(raw)
        def tell(self):return self.count
        def flush(self):pass
    stream=WriteOnly()
    with zipfile.ZipFile(stream,'w') as z:
        for name,raw,mode in rows:
            info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.create_system=3;info.create_version=45
            info.external_attr=mode<<16;info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,raw)
    data['artifact']=stream.buffer.getvalue()
    manifest={'expandedBytes':sum(len(row[1]) for row in rows),
              'files':[{'path':name,'bytes':len(raw),'sha256':r.sha(raw)} for name,raw,_ in rows],
              'runtimeExecuted':False}
    data['manifest']=r.canonical(manifest)
    return rebind_archive(data)

def rebind_archive(data):
    artifacts=r.parse(data['artifacts'],262144)
    artifacts['artifacts'][0]['size_in_bytes']=len(data['artifact'])
    artifacts['artifacts'][0]['digest']='sha256:'+r.sha(data['artifact'])
    data['artifacts']=r.canonical(artifacts)
    binding=r.parse(data['binding'],8192)
    for key in ('artifact','artifacts','manifest'):binding[key+'Sha256']=r.sha(data[key])
    binding['artifactBytes']=len(data['artifact']);binding['manifestBytes']=len(data['manifest'])
    data['binding']=r.canonical(binding)
    return data

def replace_last_compressed_span(data,new_span):
    archive=data['artifact']
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        last=z.infolist()[-1]
        local=struct.unpack_from('<IHHHHHIIIHH',archive,last.header_offset)
        data_at=last.header_offset+30+local[-2]+local[-1]
        old_size=last.compress_size
    desc_at=data_at+old_size
    old_central=struct.unpack_from('<I',archive,len(archive)-22+16)[0]
    cursor=old_central;last_central=None
    for _ in range(106):
        last_central=cursor
        fields=struct.unpack_from('<IHHHHHHIIIHHHHHII',archive,cursor)
        cursor+=46+fields[10]+fields[11]+fields[12]
    assert cursor==len(archive)-22
    delta=len(new_span)-old_size
    changed=bytearray(archive[:data_at]+new_span+archive[desc_at:])
    struct.pack_into('<I',changed,desc_at+delta+8,len(new_span))
    struct.pack_into('<I',changed,last_central+delta+20,len(new_span))
    struct.pack_into('<I',changed,len(changed)-22+16,old_central+delta)
    data['artifact']=bytes(changed)
    return rebind_archive(data)

class FailureOnly(unittest.TestCase):
    def setUp(self):self.packet=synthetic()
    def grade(self,packet=None):return r.audit(*encoded(packet or self.packet))
    def test_failed_attempt_is_never_adoption(self):
        result=self.grade()
        self.assertEqual(result['classification'],'failed-attempt-only')
        for key in ('performancePassed','adoptionQualified','coreSpeedupQualified','guestQualified','physicalRTxQualified','fullOSQualified'):self.assertIs(result[key],False)
        self.assertLess(result['minimumCPUSpeedup'],1)
    def test_exact_historical_reader_still_refuses(self):
        old_raw=zlib.decompress(base64.b85decode(OLD_SOURCE_B85))
        self.assertEqual(r.sha(old_raw),r.OLD_READER_SHA)
        old=types.ModuleType('reviewed_historical_reader')
        exec(compile(old_raw,'reviewed-historical-reader.py','exec'),old.__dict__)
        with self.assertRaisesRegex(old.Refusal,'inactive unit readback'):
            old.audit(*encoded(self.packet))
    def test_official_and_archive_joins(self):
        raw,binding,expected=synthetic_official(self.packet)
        def grade():return r.official(raw['run'],raw['jobs'],raw['artifacts'],raw['artifact'],raw['jobLog'],raw['manifest'],raw['original'],raw['cleanup'],raw['request'],raw['event'],expected,binding)
        self.assertIs(grade()['officialMetadataAuthenticated'],False)
        bad_jobs=r.parse(raw['jobs'],1048576);bad_jobs['jobs'][0]['steps'][0]['number']=True
        old=raw['jobs'];raw['jobs']=r.canonical(bad_jobs);binding['jobsSha256']=r.sha(raw['jobs'])
        with self.assertRaises(r.Refusal):grade()
        raw['jobs']=old;binding['jobsSha256']=r.sha(old)
        bad_jobs=r.parse(raw['jobs'],1048576);bad_jobs['jobs'][0]['steps'][7]['conclusion']='success'
        raw['jobs']=r.canonical(bad_jobs);binding['jobsSha256']=r.sha(raw['jobs'])
        with self.assertRaises(r.Refusal):grade()
        raw['jobs']=old;binding['jobsSha256']=r.sha(old)
        bad_run=r.parse(raw['run'],262144);bad_run['head_sha']='f'*40
        raw['run']=r.canonical(bad_run);binding['runSha256']=r.sha(raw['run'])
        with self.assertRaises(r.Refusal):grade()
        raw['artifact']=raw['artifact']+b'coherent different archive';binding['artifactSha256']=r.sha(raw['artifact']);binding['artifactBytes']=len(raw['artifact'])
        with self.assertRaises(r.Refusal):grade()
    def test_exact_reviewed_duplicate_step_roster(self):
        raw,binding,expected=synthetic_official(self.packet)
        steps=r.parse(raw['jobs'],1048576)['jobs'][0]['steps']
        self.assertEqual(len(steps),16)
        self.assertEqual(sum(step['name']==r.CHECKOUT_STEP for step in steps),4)
        self.assertEqual(sum(step['name']==r.POST_CHECKOUT_STEP for step in steps),4)
        def grade(changed):
            trial=raw.copy();bound=binding.copy();jobs=r.parse(raw['jobs'],1048576)
            changed(jobs['jobs'][0]['steps'])
            trial['jobs']=r.canonical(jobs);bound['jobsSha256']=r.sha(trial['jobs'])
            return r.official(trial['run'],trial['jobs'],trial['artifacts'],trial['artifact'],trial['jobLog'],trial['manifest'],trial['original'],trial['cleanup'],trial['request'],trial['event'],expected,bound)
        self.assertIs(grade(lambda _:None)['officialMetadataAuthenticated'],False)
        cuts=(
            lambda s:s[4].update(name=s[5]['name']), # unreviewed duplicate
            lambda s:s.pop(4), # missing checkout
            lambda s:s.__setitem__(slice(4,6),s[4:6][::-1]), # reordered steps
            lambda s:s[4].update(number=11),
            lambda s:s[4].update(number=True),
            lambda s:s[4].update(conclusion='skipped'),
            lambda s:s[7].update(name=s[8]['name']), # critical work role
            lambda s:s[7].update(conclusion='success'),
            lambda s:s[10].update(conclusion='success'), # generated setup post-step
        )
        for index,cut in enumerate(cuts):
            with self.subTest(index=index):
                with self.assertRaises(r.Refusal):grade(cut)
    def test_complete_offline_binding(self):
        data=synthetic_bundle(self.packet)
        self.assertEqual(r.audit_bundle(data)['classification'],'failed-attempt-only')
        data['historicalReader']=data['historicalReader']+b'changed'
        with self.assertRaises(r.Refusal):r.audit_bundle(data)
    def test_coherent_physical_archive_cuts(self):
        base=synthetic_bundle(self.packet)
        prefix='read16-paired-12345-1/'
        cases=(
            lambda rows:[(n,b,0o120777 if n==prefix+'paired.original.json' else mode) for n,b,mode in rows],
            lambda rows:[(n,b,0o040755 if n==prefix+'paired.original.json' else mode) for n,b,mode in rows],
            lambda rows:[(prefix+'PAIRED.original.json' if n==prefix+'paired.original.json' else n,b,mode) for n,b,mode in rows],
            lambda rows:[(prefix+'unexpected.original' if n==prefix+'paired.original.json' else n,b,mode) for n,b,mode in rows],
            lambda rows:[(prefix+'../paired.original.json' if n==prefix+'paired.original.json' else n,b,mode) for n,b,mode in rows],
            lambda rows:[(prefix+'request.original.json' if n==prefix+'paired.original.json' else n,b,mode) for n,b,mode in rows],
        )
        for index,change in enumerate(cases):
            with self.subTest(index=index):
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore',UserWarning)
                    data=changed_archive(copy.deepcopy(base),change)
                with self.assertRaises(r.Refusal):r.audit_bundle(data)
    def test_coherent_manifest_hash_cut(self):
        data=synthetic_bundle(self.packet)
        manifest=r.parse(data['manifest'],65536)
        manifest['files'][0]['sha256']='0'*64
        data['manifest']=r.canonical(manifest)
        binding=r.parse(data['binding'],8192)
        binding['manifestBytes']=len(data['manifest'])
        binding['manifestSha256']=r.sha(data['manifest'])
        data['binding']=r.canonical(binding)
        with self.assertRaises(r.Refusal):r.audit_bundle(data)
    def test_unindexed_local_header_and_central_alias(self):
        base=synthetic_bundle(self.packet)
        archive=base['artifact'];eocd=len(archive)-22
        central_at=struct.unpack_from('<I',archive,eocd+16)[0]
        orphan=struct.pack('<IHHHHHIIIHH',0x04034b50,20,8,8,0,0,0,0,0,9,0)+b'orphan123'
        changed=bytearray(archive[:central_at]+orphan+archive[central_at:])
        struct.pack_into('<I',changed,len(changed)-22+16,central_at+len(orphan))
        data=copy.deepcopy(base);data['artifact']=bytes(changed);rebind_archive(data)
        with zipfile.ZipFile(io.BytesIO(data['artifact'])) as z,zipfile.ZipFile(io.BytesIO(archive)) as original:
            self.assertEqual(len(z.infolist()),106)
            self.assertEqual(z.namelist(),original.namelist())
        with self.assertRaises(r.Refusal):r.audit_bundle(data)
        changed=bytearray(archive)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            self.assertNotEqual(z.infolist()[0].header_offset,z.infolist()[1].header_offset)
            second_offset=z.infolist()[1].header_offset
        struct.pack_into('<I',changed,central_at+42,second_offset)
        data=copy.deepcopy(base);data['artifact']=bytes(changed);rebind_archive(data)
        with self.assertRaises(r.Refusal):r.audit_bundle(data)
        changed=bytearray(archive)
        old_size=struct.unpack_from('<I',changed,central_at+20)[0]
        struct.pack_into('<I',changed,central_at+20,old_size+1)
        data=copy.deepcopy(base);data['artifact']=bytes(changed);rebind_archive(data)
        with self.assertRaises(r.Refusal):r.audit_bundle(data)
    def test_raw_deflate_exact_consumption(self):
        base=synthetic_bundle(self.packet)
        archive=base['artifact']
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            last=z.infolist()[-1]
            local=struct.unpack_from('<IHHHHHIIIHH',archive,last.header_offset)
            begin=last.header_offset+30+local[-2]+local[-1]
            span=archive[begin:begin+last.compress_size]
            last_body=z.read(last)
        trailing=replace_last_compressed_span(copy.deepcopy(base),span+b'JUNKJUNK')
        with zipfile.ZipFile(io.BytesIO(trailing['artifact'])) as z:
            self.assertEqual(z.read(z.infolist()[-1]),last_body)
        with self.assertRaisesRegex(r.Refusal,'raw DEFLATE'):
            r.audit_bundle(trailing)
        truncated=replace_last_compressed_span(copy.deepcopy(base),span[:-1])
        with self.assertRaisesRegex(r.Refusal,'raw DEFLATE'):
            r.audit_bundle(truncated)
        pack=zlib.compressobj(9,zlib.DEFLATED,-15)
        bomb=pack.compress(b'X'*(r.CAP+1))+pack.flush()
        over=replace_last_compressed_span(copy.deepcopy(base),bomb)
        with self.assertRaisesRegex(r.Refusal,'raw DEFLATE'):
            r.audit_bundle(over)
    def test_mutants_refuse(self):
        cuts=(
            lambda p:p[0]['children'][0]['resource']['before'].update(populated=0),
            lambda p:p[0]['children'][0]['resource']['before'].update(descendants=1),
            lambda p:p[0]['children'][0]['usage'].update(primary={'phase':'unknown'}),
            lambda p:p[0]['children'][0].update(arm='B'),
            lambda p:p[0]['children'][0]['resource']['preexec'].update(unit='other.service'),
            lambda p:p[0]['children'][0]['resource']['preexec'].update(pids=[1000,2000,3000]),
            lambda p:p[0]['children'][0].update(stdoutBase64=''),
            lambda p:p[0].update(failure=None),
            lambda p:p[1].update(cgroupAbsent=False),
            lambda p:p[1].update(remainingPids=[1000]),
            lambda p:p[1].update(nestedGroups=['child']),
            lambda p:p[1].update(stopExit=1),
            lambda p:p[1].update(showStdoutBase64=base64.b64encode(b'ExecMainPID=0\nControlGroup=\nLoadState=loaded\nActiveState=inactive\n').decode()),
            lambda p:p[4].update(jobId=True),
            lambda p:p[0]['source'].update(tree='f'*40),
        )
        for index,mutate in enumerate(cuts):
            with self.subTest(index=index):
                p=copy.deepcopy(self.packet);mutate(p)
                with self.assertRaises((r.Refusal,ValueError,KeyError)):self.grade(p)

if __name__=='__main__':unittest.main()
