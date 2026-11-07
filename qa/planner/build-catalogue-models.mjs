/* Photo-interpreted catalogue models. Metres; X length, Z width, Y up.
   Run: node qa/planner/build-catalogue-models.mjs
   SW-E110 (no dimensions) and SW-A411 (no photograph) intentionally stay paused.
   Existing five pilot GLBs are preserved byte for byte. */
import { Model, fit, glb, BY, MAT } from './build-pilot-models.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
Object.assign(MAT, { red:['#C74132',.65], metal:['#88918C',.4], black:['#303834',.6], blue:['#277DA1',.65], canvas:['#CFB780',.9], pink:['#CC527C',.85] });
const C = {};
const v=(x,y,z)=>[x,y,z];
function box(M,m,x,y,z,l,h,w) { M.box(m,x-l/2,x+l/2,y,y+h,z-w/2,z+w/2); }
function beam(M,m,a,b,t=.08) { M.beam(m,a,b,t); }
function rail(M,a,b,h=.6,m='timber',t=.04) {
 beam(M,m,[a[0],a[1]+h,a[2]],[b[0],b[1]+h,b[2]],.06);
 const n=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/.16));
 for(let i=0;i<=n;i++){let p=a.map((x,j)=>x+(b[j]-x)*i/n);beam(M,m,p,[p[0],p[1]+h,p[2]],t);}
}
function tower(M,{x=0,z=0,l=1.1,w=1.1,deck=1.2,h=2.8,roof='gable',m='timber',roofmat='roof',walls=false}) {
 const eave=h-(['none','castle'].includes(roof)?.03:roof==='spire'?.9:.65), xs=[x-l/2+.055,x+l/2-.055],zs=[z-w/2+.055,z+w/2-.055];
 M.posts(m,xs,zs,0,eave,.1);box(M,m,x,deck-.06,z,l,.06,w);
 for(const zz of [z-w/2,z+w/2])rail(M,[x-l/2,deck,zz],[x+l/2,deck,zz],Math.min(.65,eave-deck-.05),m);
 if(walls) { for(const xx of xs)for(const zz of zs)beam(M,m,[xx,deck,zz],[xx,eave,zz],.11); }
 if(roof==='gable')M.gable(roofmat==='roof'&&m==='darkTimber'?'darkTimber':roofmat,x-l/2-.08,x+l/2+.08,eave,h,w/2+.08,9,z);
 if(roof==='spire') {
  const a=[x-l/2-.06,eave,z-w/2-.06],b=[x+l/2+.06,eave,z-w/2-.06],c=[x+l/2+.06,eave,z+w/2+.06],d=[x-l/2-.06,eave,z+w/2+.06],p=[x,h,z];
  for(const [u,q] of [[a,b],[b,c],[c,d],[d,a]]) M.tri(roofmat,u,q,p);
 }
 if(roof==='castle') {
  for(const zz of [z-w/2,z+w/2])panel(M,x,zz,l,h-.65,.42,m);
  for(const xx of [x-l/2,x+l/2])box(M,m,xx,h-.65,z,.06,.42,w);
  for(const zz of [z-w/2,z+w/2])for(let i=0;i<6;i++)box(M,m,x-l/2+(i+.5)*l/6,eave-.2,zz,l/9,.23,.07);
 }
}
function ladder(M,a,b,w=.6,m='timber',steps=7) {
 let d=[b[0]-a[0],0,b[2]-a[2]],n=Math.hypot(d[0],d[2])||1,s=[-d[2]/n*w/2,0,d[0]/n*w/2];
 for(const sign of [-1,1])beam(M,m,a.map((q,j)=>q+sign*s[j]),b.map((q,j)=>q+sign*s[j]),.055);
 for(let i=1;i<=steps;i++){let p=a.map((q,j)=>q+(b[j]-q)*i/(steps+1));beam(M,m,p.map((q,j)=>q-s[j]),p.map((q,j)=>q+s[j]),.045);}
}
function ramp(M,a,b,w=.7,m='timber') {
 let dx=b[0]-a[0],dz=b[2]-a[2],n=Math.hypot(dx,dz)||1,s=[-dz/n,0,dx/n];
 const c=(p,k,y=0)=>[p[0]+s[0]*k,p[1]+y,p[2]+s[2]*k];M.quad(m,c(a,-w/2),c(a,w/2),c(b,w/2),c(b,-w/2));M.quad(m,c(a,-w/2,-.04),c(b,-w/2,-.04),c(b,w/2,-.04),c(a,w/2,-.04));
 for(let i=1;i<=6;i++){let t=i/7,p=a.map((q,j)=>q+(b[j]-q)*t);p[0]+=s[0]*w*(i%2?.23:-.23);p[2]+=s[2]*w*(i%2?.23:-.23);box(M,['holdA','holdB','holdC'][i%3],p[0],p[1]+.035,p[2],.07,.055,.075);}
}
function slide(M,a,b,w=.55,m='green') {
 const pts=[];for(let i=0;i<=16;i++){let t=i/16;pts.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*(t*t*(3-2*t)),a[2]+(b[2]-a[2])*t]);}M.slide(m,pts,w/2,.12);
}
function swingBay(M,x0,x1,z,h,w,seats=2,m='timber') {
 beam(M,m,[x0,h-.06,z],[x1,h-.06,z],.11);
 for(const x of [x0+.06,x1-.06])for(const zz of [z-w/2+.06,z+w/2-.06])beam(M,m,[x,h-.06,z],[x,0.04,zz],.09);
 for(let i=0;i<seats;i++){let x=x0+(i+1)*(x1-x0)/(seats+1);for(const zz of [-.16,.16])M.rod('rope',[x,h-.15,z+zz],[x,.48,z+zz],.012,6);box(M,'seat',x,.45,z,.24,.045,.4);}
}
function bridge(M,x0,x1,z,deck,w=.8,m='timber',sag=0) {
 const n=Math.ceil((x1-x0)/.16);for(let i=0;i<n;i++){let x=x0+(i+.5)*(x1-x0)/n,y=deck-sag*Math.sin(Math.PI*(i+.5)/n);box(M,m,x,y-.05,z,(x1-x0)/n*.85,.05,w);}
 for(const zz of [z-w/2,z+w/2])rail(M,[x0,deck,zz],[x1,deck,zz],.7,m);
}
function tunnel(M,x0,x1,z,y,r=.4,m='yellow') {
 const n=20;for(let i=0;i<n;i++){let a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;M.quad(m,[x0,y+r*Math.sin(a),z+r*Math.cos(a)],[x1,y+r*Math.sin(a),z+r*Math.cos(a)],[x1,y+r*Math.sin(b),z+r*Math.cos(b)],[x0,y+r*Math.sin(b),z+r*Math.cos(b)]);}
 for(const x of [x0,x1])M.tube('timber',Array.from({length:25},(_,i)=>[x,y+r*1.04*Math.sin(i/24*Math.PI*2),z+r*1.04*Math.cos(i/24*Math.PI*2)]),.035);
}
function net(M,a,b,cols=6,rows=7,m='rope') { // rectangle in 3D: a and b opposite corners, grid on XY or YZ
 for(let i=0;i<=cols;i++){const t=i/cols,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t;M.rod(m,[x,a[1],z],[x,b[1],z],.009,5);}
 for(let i=0;i<=rows;i++){const y=a[1]+(b[1]-a[1])*i/rows;M.rod(m,[a[0],y,a[2]],[b[0],y,b[2]],.009,5);}
}
function trampoline(M,x,z,l,w,h) {
 const xs=[x-l/2+.06,x+l/2-.06],zs=[z-w/2+.06,z+w/2-.06];M.posts('timber',xs,zs,0,h-.05,.1);box(M,'seat',x,.34,z,l-.12,.035,w-.12);
 for(const zz of zs){beam(M,'timber',[xs[0],h-.05,zz],[xs[1],h-.05,zz],.1);net(M,[xs[0],.4,zz],[xs[1],h-.1,zz],12,12,'black');}
 for(const xx of xs){beam(M,'timber',[xx,h-.05,zs[0]],[xx,h-.05,zs[1]],.1);net(M,[xx,.4,zs[0]],[xx,h-.1,zs[1]],10,12,'black');}
 for(const zz of zs)for(let j=0;j<4;j++)box(M,'timber',x,.03+j*.075,zz,l-.1,.05,.05);
}
function sand(M,x,z,l,w){box(M,'sand',x,0,z,l,.035,w);for(const zz of [z-w/2+.04,z+w/2-.04])box(M,'timber',x,0,zz,l,.12,.08);for(const xx of [x-l/2+.04,x+l/2-.04])box(M,'timber',xx,0,z,.08,.12,w);}
function flag(M,x,z,h){M.rod('rope',[x,h-.25,z],[x,h,z],.012,5);M.tri('flag',[x,h,z],[x,h-.16,z],[x+.18,h-.08,z]);}
function panel(M,x,z,l,base,h,m='timber',window=false) {
 for(let i=0;i<Math.ceil(l/.13);i++){let xx=x-l/2+(i+.5)*l/Math.ceil(l/.13);if(window&&Math.abs(xx-x)<l*.23){box(M,m,xx,base,z,l/Math.ceil(l/.13)*.92,h*.28,.035);box(M,m,xx,base+h*.77,z,l/Math.ceil(l/.13)*.92,h*.23,.035);}else box(M,m,xx,base,z,l/Math.ceil(l/.13)*.92,h,.035);}
}
function cabin(M,x,z,l,w,base,h,m='timber',open=false){
 tower(M,{x,z,l,w,deck:base,h,roof:'gable',m});const e=h-.65;
 if(!open){panel(M,x,z+w/2,l,base,e-base,m,true);panel(M,x,z-w/2,l,base,e-base,m,true);for(const xx of [x-l/2,x+l/2]){box(M,m,xx,base,z-w*.34,.04,e-base,w*.28);box(M,m,xx,base,z+w*.34,.04,e-base,w*.28);box(M,m,xx,e-.15,z,.04,.15,w);}}
}
// Estate collection: individually composed silhouettes and component layouts.
C['SW-E101']=(M,d)=>{for(const [x,z] of [[-3.6,-1.65],[-.6,-1.65],[2.4,-1.65],[2.4,1.65]])tower(M,{x,z,l:1.25,w:1.25,deck:1.5,h:3.3,m:'darkTimber'});bridge(M,-3.6,-.6,-1.65,1.5);bridge(M,-.6,2.4,-1.65,1.5);for(const x of [-3.9,-3.3,-.9,-.3,2.1])slide(M,[x,1.5,-1.1],[x-1.1,.04,4.1],.52);slide(M,[2.4,1.5,2.2],[4.9,.04,2.2]);slide(M,[2.9,1.5,-1.6],[5.2,.04,-1.6]);ramp(M,[-4.9,.03,-1.65],[-4.1,1.5,-1.65],.8);swingBay(M,-.6,2.4,1.2,2.65,2.2,2,'darkTimber');};
C['SW-E102']=(M,d)=>{for(const x of [-2.4,-.7,.9])tower(M,{x,z:-.55,l:1.05,w:1.05,deck:2.05,h:4,m:'darkTimber'});bridge(M,-2.4,.9,-.55,2.05,.7,'darkTimber');slide(M,[-2.4,2.05,-.1],[-4.05,.04,1.32],.58,'lime');ladder(M,[-.5,.02,1.5],[-.7,2.05,-.08],.8,'darkTimber');swingBay(M,1,4.2,0,2.7,3.1,3,'darkTimber');ladder(M,[-3.9,.02,-1.4],[-2.9,2.05,-.55],.65,'darkTimber');};
C['SW-E103']=(M,d)=>{for(const x of [-3.8,-1.9,0])tower(M,{x,z:-.4,l:1.1,w:1.1,deck:1.5,h:3.3,m:'darkTimber'});tunnel(M,-3.25,-2.45,-.4,1.9,.38);tunnel(M,-1.35,-.55,-.4,1.9,.38);for(const x of [-4,-3.5,-1.9,0])slide(M,[x,1.5,.15],[x-.25,.04,1.8],.48,'lime');swingBay(M,.5,4.65,-.35,2.65,2.7,3,'darkTimber');};
C['SW-E105']=(M,d)=>{tower(M,{x:.5,z:0,l:1.25,w:1.25,deck:1.5,h:3.3});swingBay(M,-4.45,-.15,0,2.55,2.82,3);swingBay(M,1.15,4.45,0,2.55,2.82,3);ramp(M,[.5,.02,1.38],[.5,1.5,.58],.8);ladder(M,[.5,.02,-1.35],[.5,1.5,-.6]);};
C['SW-E106']=(M,d)=>{tower(M,{x:.9,z:-.35,l:1.25,w:1.25,deck:1.5,h:3.3,m:'darkTimber'});swingBay(M,-3.75,.2,-.1,2.65,2.9,2,'darkTimber');for(const x of [.62,1.18])slide(M,[x,1.5,.25],[3.55,.04,1.35+(x-.9)*.5],.47,'green');ramp(M,[.9,.02,-1.45],[.9,1.5,-.9],.85,'darkTimber');ladder(M,[2.3,.02,-1.4],[1.5,1.5,-.4],.6);};
C['SW-E107']=(M,d)=>{for(const z of [-.9,.9]){panel(M,-1.5,z,3.5,.15,.8,'darkTimber');M.tri('darkTimber',[-3.25,.15,z],[-4.15,.7,0],[-3.25,1.1,z]);}box(M,'timber',-1.4,1.4,0,3.6,.1,1.8);tower(M,{x:-2.5,l:1,w:1.6,deck:1.5,h:2.6,roof:'none',m:'darkTimber'});M.rod('darkTimber',[-1.2,0,0],[-1.2,4,0],.065);M.quad('canvas',[-1.15,2.5,0],[-1.15,3.7,0],[.2,3.7,0],[.2,2.5,0]);flag(M,-1.2,0,4);slide(M,[-.4,1.5,.8],[.3,.04,2.2],.65);ramp(M,[-2.5,.04,-2.18],[-2.5,1.5,-.8],.9,'darkTimber');swingBay(M,.5,4.15,-.2,2.5,2.9,2,'darkTimber');};
C['SW-E108']=(M,d)=>{trampoline(M,-2.05,0,3.55,3.08,2.8);tower(M,{x:.95,z:-.65,l:1.2,w:1.2,deck:1.2,h:3.2});for(const x of [.65,1.25])slide(M,[x,1.2,-.08],[3.55,.04,1.28+(x-.95)*.25],.5);ladder(M,[2.15,.04,-1.45],[1.5,1.2,-.65],.6);};
C['SW-E109']=(M,d)=>{cabin(M,-1.65,-.4,1.1,1.2,.6,2.1);cabin(M,1.65,-.4,1.1,1.2,.6,2.5);bridge(M,-1.1,1.1,-.4,.6,.7);for(const x of [-1.65,1.65])slide(M,[x,.6,.2],[x,.04,1.05],.45,'red');ladder(M,[0,.03,1],[0,.6,-.15],.65);box(M,'black',-2.25,.15,-.6,.08,.65,.9);};
C['SW-E111']=(M,d)=>{tower(M,{x:-2.3,z:-.4,l:1.15,w:1.15,deck:1.3,h:3.3});tower(M,{x:1.6,z:-.4,l:1.15,w:1.15,deck:1.3,h:2.8});tower(M,{x:-.4,z:-.4,l:.9,w:1.15,deck:1.3,h:2.1,roof:'none'});tunnel(M,-1.7,-.9,-.4,1.7,.36);bridge(M,.05,1.05,-.4,1.3,.7);slide(M,[-2.3,1.3,.15],[-3.2,.04,1.25],.6);for(const x of [1.3,1.9])slide(M,[x,1.3,.15],[2.9+(x-1.6)*.3,.04,1.45],.48);ladder(M,[-.4,.02,1.15],[-.4,1.3,.1],.7);};
C['SW-E112']=(M,d)=>{for(const x of [-3.12,3.12])trampoline(M,x,0,2.4,2.28,3.2);for(const z of [-.4,.4])beam(M,'timber',[-1.92,2.8,z],[1.92,2.8,z]);for(let x=-1.8;x<1.9;x+=.3)beam(M,'timber',[x,2.8,-.4],[x,2.8,.4],.045);for(const x of [-.65,.65]){for(const z of [-.16,.16])M.rod('rope',[x,2.75,z],[x,.48,z],.012);box(M,'seat',x,.45,0,.3,.04,.4);}ladder(M,[4.25,.03,1.1],[3.7,.36,.5],.65);};
// Tower recipes share joinery, but retain distinct roof, access and activity layouts.
function playTower(M,d,o={}){
 const {l:L,w:W,h:H}=d, x=o.swing?-L*.04:0,z=o.wide? -W*.2:0,tw=Math.min(1.2,W*.72),tl=Math.min(1.2,L*.34),deck=Math.min(1.4,H*.45),m=o.dark?'darkTimber':'paleTimber';
 tower(M,{x,z,l:tl,w:tw,deck,h:H,roof:o.roof||'gable',m,roofmat:o.roofmat||'roof'});
 if(o.swing){swingBay(M,-L/2+.06,x-tl/2+.05,0,H*.78,W*.88,o.seats||2,m);slide(M,[x+tl/2,deck,z],[L/2-.15,.04,W/2-.2],.55,o.slide||'green');ramp(M,[L/2-.13,.03,-W/2+.15],[x+tl/2,deck,z],.65,m);}
 else {slide(M,[x+tl/2,deck,z],[L/2-.12,.04,z],.55,o.slide||'green');ladder(M,[-L/2+.1,.03,z],[x-tl/2,deck,z],.6,m);if(o.wide){bridge(M,-L*.25,x,z,deck,.65,m);ramp(M,[-L*.25,.03,W/2-.12],[-L*.25,deck,z],.7,m);}else sand(M,x,z,tl,Math.max(tw,W*.88));}
 if(o.pole)M.rod('yellow',[x+tl/2,0,z-tw/2],[x+tl/2,H*.75,z-tw/2],.025,8);
 if(o.flags)flag(M,x,z,H);
}
C['SW-T201']=(M,d)=>playTower(M,d,{swing:true,roof:'castle',slide:'red'});
C['SW-T202']=(M,d)=>{tower(M,{x:.4,z:-.5,l:1.05,w:1.05,deck:1.4,h:3.4,roof:'spire',m:'paleTimber'});tower(M,{x:-1.1,z:-.5,l:.8,w:.8,deck:1.1,h:2.1,roof:'castle',m:'paleTimber'});bridge(M,-1.1,.4,-.5,1.2,.65);slide(M,[.4,1.4,0],[1.9,.04,1.85],.6,'lime');swingBay(M,-2.2,-.6,.45,2.2,2.9,2);ramp(M,[1.9,.03,-1.8],[.9,1.4,-.5],.7);};
C['SW-T203']=(M,d)=>playTower(M,d,{pole:true});
C['SW-T204']=(M,d)=>{tower(M,{x:.7,z:-.8,l:1.2,w:1.2,deck:1.25,h:2.8,roofmat:'green',m:'paleTimber'});tower(M,{x:-1.4,z:.7,l:1.25,w:1.1,deck:1.2,h:2.4,roof:'none',m:'paleTimber'});bridge(M,-1.4,.7,.1,1.2,.8);slide(M,[1.3,1.25,-.8],[2.25,.04,2.15],.6);sand(M,-1.4,.7,1.3,1.2);sand(M,.7,-.8,1.3,1.2);ladder(M,[-2.25,.03,-2.2],[-1.4,1.2,.25],.65);};
C['SW-T205']=(M,d)=>{tower(M,{x:.5,z:0,l:1.1,w:1.1,deck:1.1,h:2.24,roof:'none',m:'paleTimber'});slide(M,[-.05,1.1,0],[-1.8,.04,0],.55);ramp(M,[1.8,.03,.45],[1,1.1,0],.8);for(const z of [-.72,.72])beam(M,'green',[-1.2,2.18,z],[1.2,2.18,z],.07);net(M,[-1.2,.05,-.72],[-1.2,2.1,.72],5,8);for(let x=-1.2;x<.1;x+=.2)beam(M,'metal',[x,2.15,-.72],[x,2.15,.72],.035);sand(M,.4,0,1.4,1.5);};
C['SW-T206']=(M,d)=>{playTower(M,d,{wide:false,roofmat:'green'});bridge(M,-.95,-.6,0,1.3,.85,'paleTimber');ramp(M,[-.95,.03,.7],[-.95,1.3,0],.6,'paleTimber');};
C['SW-T207']=(M,d)=>playTower(M,d,{wide:true,roofmat:'red'});
C['SW-T208']=(M,d)=>{playTower(M,d,{wide:true});bridge(M,-.5,.8,.2,1.1,.75,'paleTimber');ladder(M,[-.2,.02,1.2],[-.2,1.1,.55],.55,'paleTimber');};
C['SW-T209']=(M,d)=>playTower(M,d,{swing:true,dark:true});
C['SW-T210']=(M,d)=>playTower(M,d,{swing:true,dark:true,flags:true,slide:'lime'});
C['SW-T212']=(M,d)=>{swingBay(M,-1.28,1.28,0,2.1,1.68,2);ladder(M,[.9,.03,-.78],[.9,1.35,0],.5);slide(M,[.9,.7,.1],[.9,.03,.72],.45,'red');};
// Early years.
C['SW-Y301']=(M,d)=>{cabin(M,.5,0,.9,1.05,.6,1.89,'paleTimber');slide(M,[.05,.6,0],[-1.88,.03,0],.45,'red');ladder(M,[1.85,.03,0],[.95,.6,0],.5);box(M,'paleTimber',.8,.38,.55,.85,.035,.22);};
C['SW-Y302']=(M,d)=>{tower(M,{x:.5,z:-.85,l:1.1,w:1.1,deck:.9,h:2.8,m:'darkTimber'});tower(M,{x:-1.4,z:-.4,l:.9,w:.9,deck:.6,h:1.3,roof:'none',m:'darkTimber'});tunnel(M,-.95,-.05,-.4,1.05,.32,'darkTimber');slide(M,[1.05,.9,-.4],[2.9,.03,1.45],.55,'lime');ladder(M,[-2.9,.03,1.75],[-1.85,.6,-.4],.65,'darkTimber');};
C['SW-Y303']=(M,d)=>{const z0=-1.04,z1=-.1;for(const z of [z0,z1])for(const x of [-.62,.62])beam(M,'paleTimber',[x,0,z],[0,1.8,z],.065);box(M,'paleTimber',0,.83,-.6,.85,.05,.95);slide(M,[0,.88,-.1],[0,.03,1.1],.5);ramp(M,[.62,.03,-.4],[0,1.5,-.4],1,'paleTimber');net(M,[-.6,.05,-1.03],[0,1.6,-1.03],5,7);};
C['SW-Y304']=(M,d)=>{for(const z of [-.32,.32]){M.tri('pink',[-.5,.02,z],[.5,.02,z],[0,.88,z]);for(const x of [-.49,.49])beam(M,'paleTimber',[x,.02,z],[0,.89,z],.04);}for(const side of [-1,1])ramp(M,[side*.5,.02,0],[0,.88,0],.6,'paleTimber');M.rod('yellow',[0,.84,0],[0,.91,0],.028);};
C['SW-Y305']=(M,d)=>{cabin(M,-.3,0,1.2,1.65,.2,1.8,'paleTimber');box(M,'paleTimber',.6,.18,0,.65,.06,1.65);rail(M,[.9,.24,-.8],[.9,.24,.25],.6,'paleTimber');ladder(M,[.95,.02,.7],[.6,.24,.7],.4,'paleTimber',2);};
C['SW-Y306']=(M,d)=>{cabin(M,-.65,-.5,1.25,1.35,.08,1.65,'paleTimber');tower(M,{x:.7,z:-.55,l:.9,w:.9,deck:1.1,h:2.8,m:'paleTimber'});slide(M,[.7,1.1,-.1],[1.15,.03,1.1],.5,'lime');rail(M,[-1.25,.12,.75],[0,.12,.75],.65);};
C['SW-Y307']=(M,d)=>{cabin(M,-.65,-.3,1.3,1.3,1.05,2.8,'paleTimber');slide(M,[0,1.05,-.3],[1.8,.03,.9],.55);ladder(M,[-1.8,.02,1.05],[-1.2,1.05,.3],.6);sand(M,-.65,-.3,1.3,1.3);};
C['SW-Y308']=(M,d)=>{cabin(M,0,0,1.43,1.23,.04,2.09,'paleTimber',true);box(M,'black',0,.5,-.61,1,.65,.035);for(const z of [-.48,.48])box(M,'paleTimber',0,.3,z,1.2,.05,.25);};
C['SW-Y309']=(M,d)=>{ // open round windows and archways are cut into slatted front walls
 for(const cx of [-1.18,1.18]){for(let i=0;i<12;i++){let x=cx-.55+(i+.5)*1.1/12,h=1.4-Math.abs(x-cx)*.55;let r=.28,dx=x-cx,cut=Math.abs(dx)<r?Math.sqrt(r*r-dx*dx):0;if(cut){box(M,'paleTimber',x,0,-.5,.078,.68-cut,.04);box(M,'paleTimber',x,.68+cut,-.5,.078,h-.68-cut,.04);}else box(M,'paleTimber',x,0,-.5,.078,h,.04);}for(const z of [-.5,.5]){beam(M,'paleTimber',[cx-.59,1.05,z],[cx,1.4,z],.04);beam(M,'paleTimber',[cx,1.4,z],[cx+.59,1.05,z],.04);}box(M,'paleTimber',cx,.02,0,1.1,.04,1.1);}
 panel(M,0,-.5,1.25,0,1.0,'paleTimber',true);};
C['SW-Y310']=(M,d)=>{cabin(M,-.8,0,1.3,1.02,.08,2.2);sand(M,.85,0,1.3,1.12);M.posts('timber',[.2,1.5],[-.5,.5],0,1.5,.07);M.quad('blue',[.2,1.5,-.55],[1.5,1.5,-.55],[1.5,1.45,.55],[.2,1.45,.55]);for(const z of [-.5,.5])box(M,'timber',-.8,.55,z,.55,.2,.15);};
function picnic(M,d,activity=false){const {l:L,w:W,h:H}=d;for(const x of [-L*.34,L*.34]){for(const z of [-W*.43,W*.43])beam(M,'paleTimber',[x,0,z],[x,H-.05,-z*.4],.045);beam(M,'paleTimber',[x,H*.35,-W*.46],[x,H*.35,W*.46],.045);}for(const z of [-W*.42,W*.42])box(M,'paleTimber',0,H*.5,z,L,.035,W*.16);for(let i=0;i<5;i++)box(M,activity?'yellow':'paleTimber',0,H-.04,-W*.22+(i+.5)*W*.44/5,L*.9,.04,W*.44/5*.94);if(activity)box(M,'yellow',L*.25,H*.67,0,L*.25,H*.25,W*.35);}
C['SW-Y312']=(M,d)=>picnic(M,d,true);C['SW-Y314']=(M,d)=>picnic(M,d);
C['SW-Y313']=(M,d)=>{const r=.34,H=d.h;for(let i=0;i<32;i++){let a=i/32*Math.PI*2,b=(i+1)/32*Math.PI*2;M.tri('paleTimber',[0,H,0],[r*Math.cos(a),H,r*Math.sin(a)],[r*Math.cos(b),H,r*Math.sin(b)]);}for(let i=0;i<4;i++){let a=i*Math.PI/2,x=Math.cos(a)*.49,z=Math.sin(a)*.49;box(M,'paleTimber',x,H*.53,z,i%2?.55:.19,.035,i%2?.19:.55);beam(M,'paleTimber',[x*.9,0,z*.9],[-x*.3,H-.03,-z*.3],.055);beam(M,'paleTimber',[0,H*.4,0],[x,H*.4,z],.06);}};
// Adventure collection.
C['SW-A401']=(M,d)=>{for(const x of [-5.8,5.8]){for(const z of [-.9,.9])beam(M,'timber',[x,0,z],[x,2.94,0],.11);beam(M,'timber',[x-.08,2.94,0],[x+.08,2.94,0],.12);}M.tube('metal',Array.from({length:25},(_,i)=>{let x=-5.8+i*11.6/24;return[x,2.94-.22*Math.sin(Math.PI*i/24),0];}),.012);M.rod('rope',[0,2.72,0],[0,.5,0],.02);box(M,'seat',0,.47,0,.3,.05,.3);box(M,'timber',5.5,.35,0,.65,.1,1.6);};
C['SW-A402']=(M,d)=>{for(const z of [-.54,.54]){M.beam('timber',[-1.9,.03,z],[-1.9,1.95,0],.1);M.beam('timber',[1.9,.03,z],[1.9,1.95,0],.1);for(let i=0;i<4;i++)ramp(M,[-1.5+i,.03,z],[-1.5+i,1.95,0],.95,'timber');}};
C['SW-A403']=(M,d)=>{let pts=Array.from({length:6},(_,i)=>[1.12*Math.cos(i*Math.PI/3),0,1.12*Math.sin(i*Math.PI/3)]);for(const p of pts)beam(M,'darkTimber',p,[p[0],2.2,p[2]],.1);for(let i=0;i<6;i++){let a=pts[i],b=pts[(i+1)%6];beam(M,'darkTimber',[a[0],2.2,a[2]],[b[0],2.2,b[2]],.1);if(i%3===0){for(let j=1;j<8;j++)beam(M,'timber',[a[0],j*.25,a[2]],[b[0],j*.25,b[2]],.04);}else if(i%3===1){if(i===1){M.quad('timber',[a[0],.1,a[2]],[b[0],.1,b[2]],[b[0],2.1,b[2]],[a[0],2.1,a[2]]);for(let j=0;j<7;j++){let t=j%2?.3:.7;box(M,['holdA','holdB','holdC'][j%3],a[0]+(b[0]-a[0])*t,.25+j*.25,a[2]+(b[2]-a[2])*t,.09,.08,.09);}}else net(M,[a[0],.1,a[2]],[b[0],2.1,b[2]],5,7);}else {let x=(a[0]+b[0])/2,z=(a[2]+b[2])/2;M.rod('rope',[x,2.2,z],[x,1.5,z],.01);M.tube('yellow',Array.from({length:17},(_,j)=>[x+.1*Math.cos(j/16*Math.PI*2),1.4+.1*Math.sin(j/16*Math.PI*2),z]),.015);}}};
C['SW-A404']=(M,d)=>{for(const x of [-2.15,-.7,.7,2.15])beam(M,'darkTimber',[x,0,0],[x,2.2,0],.1);beam(M,'timber',[-2.2,2.2,0],[2.2,2.2,0],.1);for(const x of [-.85,.85]){panel(M,x,0,.9,.05,2.1,'darkTimber');for(let j=0;j<7;j++)box(M,j%2?'lime':'yellow',x+(j%2?.23:-.23),.25+j*.25,.04,.1,.07,.08);}net(M,[-2.1,.1,0],[-1.4,2.1,0]);ladder(M,[1.4,0,0],[1.4,2.1,.01],.55);slide(M,[0,1,.01],[0,.03,.4],.55,'lime');box(M,'timber',0,0,-.48,4.3,.045,.08);};
function palm(M,x,z,h){beam(M,'timber',[x,0,z],[x,h-.35,z],.13);for(let i=0;i<7;i++){let a=i*Math.PI*2/7;M.tri('green',[x,h-.15,z],[x+.62*Math.cos(a),h-.45,z+.62*Math.sin(a)],[x+.35*Math.cos(a+.5),h,z+.35*Math.sin(a+.5)]);}}
C['SW-A405']=(M,d)=>{for(const [x,z] of [[-2.8,-1.6],[2.8,-1.6],[-2.8,1.6],[2.8,1.6]])palm(M,x,z,2.7);for(const z of [-1.6,1.6])beam(M,'timber',[-2.8,2.25,z],[2.8,2.25,z]);for(let x=-2.7;x<2.8;x+=.3)beam(M,'timber',[x,2.25,-1.6],[x,2.25,-.6],.05);bridge(M,-2.8,-.8,.8,.25,.9);ramp(M,[-.7,.02,1.9],[.7,.7,.4],1);box(M,'timber',1.8,.2,1,1.6,.1,1.2);net(M,[-2.8,.25,-1.6],[-1,2.2,-1.6]);};
C['SW-A406']=(M,d)=>{for(const x of [-4.2,-1.4,1.4,4.2])box(M,'timber',x,.15,0,.9,.1,1.2);tunnel(M,2.3,3.8,0,.78,.48,'timber');for(const x of [-3.7,-2.2])for(const z of [-.5,.5])beam(M,'timber',[x,0,z],[x,1.65,z],.07);for(const z of [-.5,.5])beam(M,'timber',[-3.7,1.65,z],[-2.2,1.65,z],.07);for(let x=-3.7;x<-2.1;x+=.23)beam(M,'timber',[x,1.65,-.5],[x,1.65,.5],.04);for(let x=-.8;x<1.3;x+=.35){box(M,'timber',x,.2,Math.sin(x*4)*.25,.22,.08,.28);for(const z of [-.5,.5])M.rod('rope',[x,1.6,z],[x,.25,0],.009);}beam(M,'timber',[-1,1.65,-.5],[1.4,1.65,-.5]);};
function suspendedBridge(M,d,m='timber',rope='rope'){const {l:L,w:W,h:H}=d;for(const x of [-L/2+.055,L/2-.055])for(const z of [-W/2+.055,W/2-.055])beam(M,m,[x,0,z],[x,H-.04,z],.09);const n=Math.ceil(L/.18);for(let i=0;i<n;i++){let x=-L/2+.08+(i+.5)*(L-.16)/n,y=.28-.13*Math.sin(Math.PI*(i+.5)/n);box(M,m,x,y,0,(L-.16)/n*.8,.045,W-.12);for(const z of [-W/2+.055,W/2-.055]){M.rod(rope,[x,y,z],[x,H-.09,z],.011,5);}}for(const z of [-W/2+.055,W/2-.055])beam(M,m,[-L/2+.05,H-.08,z],[L/2-.05,H-.08,z],.06);}
C['SW-A407']=(M,d)=>suspendedBridge(M,d);C['SW-A412']=(M,d)=>suspendedBridge(M,d,'timber','yellow');
C['SW-A408']=(M,d)=>{box(M,'timber',0,.1,0,.3,.7,.5);M.beam('timber',[-1.45,.45,0],[1.45,.7,0],.48,.065);for(const x of [-1.1,1.1]){for(const z of [-.25,.25])M.tube('yellow',[[x,.55,z],[x,.98,z],[x,1.17,z*.5],[x,1.17,-z*.5]],.02,8);} }; 
C['SW-A410']=(M,d)=>{for(const x of [-.46,.46])beam(M,'timber',[x,0,0],[x,1.16,0],.08);for(const y of [.35,.64,.93]){M.rod('metal',[-.4,y,0],[.4,y,0],.012);for(const x of [-.25,0,.25]){M.rod('green',[x-.1,y,0],[x+.1,y,0],.043,12);const r=.045;M.tube('yellow',Array.from({length:17},(_,i)=>[x+r*Math.cos(i/16*Math.PI*2),y+r*Math.sin(i/16*Math.PI*2),.047]),.006,5);}}};
// Benches: catalogue names resolve the 507/508 photo mismatch; no catalogue data is edited.
function bench(M,d,o={}){const {l:L,w:W,h:H}=d,seat=o.back===false?Math.min(.45,H):H*.54,mat=o.dark?'darkTimber':'slats',metal=o.metal||'metal';
 for(let i=0;i<4;i++)box(M,mat,0,seat-.035,-W*.32+(i+.5)*W*.64/4,L,.035,W*.64/4*.9);
 for(const x of [-L/2+.1,L/2-.1]){if(o.hoop){let r=(H-.05)/2;M.tube(metal,Array.from({length:33},(_,i)=>[x,r+.025+r*Math.sin(i/32*Math.PI*2),r*Math.cos(i/32*Math.PI*2)*W/H]),.025,10);}else if(o.loop){for(const z of [-W*.43,W*.43])beam(M,metal,[x,0,z],[x,seat,z],.045);beam(M,metal,[x,0,-W*.43],[x,0,W*.43],.045);beam(M,metal,[x,seat,-W*.43],[x,seat,W*.43],.045);}else{for(const z of [-W*.43,W*.43])beam(M,metal,[x,0,z],[x,seat,z*.6],.04);beam(M,metal,[x,seat,-W*.4],[x,seat,W*.4],.04);}}
 if(o.back!==false){for(const x of [-L/2+.1,L/2-.1])beam(M,metal,[x,seat,W*.18],[x,H-.02,W*.43],.035);for(let i=0;i<3;i++)box(M,mat,0,seat+.12+i*(H-seat-.13)/3,W*.3+i*.025,L,.08,.035);}
 if(o.arms)for(const x of [-L/2+.1,L/2-.1])M.tube(metal,[[x,seat,W*.28],[x,H*.84,W*.23],[x,H*.86,-W*.35],[x,seat,-W*.43]],.025,10);
}
C['SW-L501']=(M,d)=>bench(M,d,{arms:true});C['SW-L502']=(M,d)=>bench(M,d,{dark:true,metal:'black'});C['SW-L504']=(M,d)=>bench(M,d,{back:false,loop:true});C['SW-L505']=(M,d)=>bench(M,d,{loop:true,arms:true});C['SW-L506']=(M,d)=>{bench(M,d,{back:false,metal:'black'});for(const x of [-d.l/2+.1,d.l/2-.1])M.tube('black',[[x,0,-d.w*.4],[x,d.h*.73,-d.w*.4],[x,d.h,-d.w*.2],[x,d.h,d.w*.2],[x,d.h*.73,d.w*.4],[x,0,d.w*.4]],.025,10);};C['SW-L507']=(M,d)=>{bench(M,d,{loop:true});for(const x of [-d.l*.16,d.l*.16])for(const z of [-.2,.2])beam(M,'metal',[x,0,z],[x,.4,z],.035);};C['SW-L508']=(M,d)=>bench(M,d,{back:false,hoop:true,metal:'black'});
C['SW-L503']=(M,d)=>{const R=3.35,w=.42,n=110;for(let i=0;i<n;i++){const a=(i+.5)/n*Math.PI;let x=R*Math.cos(a),z=R*Math.sin(a);M.beam('slats',[x-w/2*Math.cos(a),.435,z-w/2*Math.sin(a)],[x+w/2*Math.cos(a),.435,z+w/2*Math.sin(a)],.065,.055);}for(let i=0;i<7;i++){let a=(i+.3)/6.6*Math.PI;box(M,'metal',R*Math.cos(a),0,R*Math.sin(a),.16,.41,.28);}};
const paused={'SW-E110':'Awaiting overall dimensions; no scale invented.','SW-A411':'Awaiting product photograph; description-only modelling paused by owner.'};
const ctx={};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(readFileSync(join(ROOT,'models/manifest.js'),'utf8'),ctx);const manifest=JSON.parse(JSON.stringify(ctx.DP_MODELS));
const report=[];
for(const [code,draw] of Object.entries(C)){
 const p=BY[code],M=new Model();draw(M,p.dims);
 // Exact dimension fitting is permitted only within the same 20% redraw limit as the pilots.
 if(process.argv.includes("--inspect")){const pts=Object.values(M.tris).flat(2),lo=[0,1,2].map(i=>Math.min(...pts.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...pts.map(p=>p[i])));console.log(code,JSON.stringify(hi.map((v,i)=>+(v-lo[i]).toFixed(3))),JSON.stringify([p.dims.l,p.dims.h,p.dims.w]));continue;}
 const stretch=fit(M,p.dims),{data,triangles}=glb(M,code,'X FORCE photo-interpreted catalogue model builder'),file=`models/${code}.glb`;
 writeFileSync(join(ROOT,file),data);const conflict=['SW-L507','SW-L508'].includes(code);
 manifest[code]={file,accuracy:'approximate',source:`Interpreted from ${conflict?'catalogue description and related bench photographs (507/508 photo labels conflict)':p.thumb} and published catalogue dimensions. Hidden geometry inferred; not an engineering drawing.`};
 report.push({code,name:p.name,file,photo:p.thumb,dimensions:p.dims,triangles,bytes:data.length,fitPercent:+(stretch*100).toFixed(2),notes:conflict?'Photo and catalogue description conflict; silhouette follows named product.':null});
 console.log(`${code}: ${triangles} triangles, ${(data.length/1024).toFixed(0)} KB, fit ${(stretch*100).toFixed(1)}%`);
}
if(process.argv.includes('--inspect'))process.exit(0);
writeFileSync(join(ROOT,'models/manifest.js'),`/* Generated by qa/planner/build-catalogue-models.mjs; five existing pilots preserved. */\nwindow.DP_MODELS = ${JSON.stringify(manifest,null,1)};\n`);
writeFileSync(join(ROOT,'models/catalogue-build-report.json'),JSON.stringify({generated:report,paused,referenceConflicts:['SW-L507','SW-L508']},null,2)+'\n');
console.log(`Created ${report.length} models; ${Object.keys(manifest).length} available; ${Object.keys(paused).length} paused.`);
