/* Pure helpers with no state and no imports — usable from any layer. */
export function pad(n,w){n=String(n);while(n.length<w)n="0"+n;return n;}
export function randInt(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
export function pick(a){return a[Math.floor(Math.random()*a.length)];}
export function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function arraysEqual(a,b){return a.length===b.length && a.every((v,i)=>v===b[i]);}
