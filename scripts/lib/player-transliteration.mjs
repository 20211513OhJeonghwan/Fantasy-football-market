import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../../data/localization/players.ko.json', import.meta.url), 'utf8'));
export const hasKoreanName = value => typeof value === 'string' && /[가-힣]/u.test(value);
const normalize = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/ł/gi, 'l').replace(/ø/gi, 'o').replace(/ß/g, 'ss').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').toLowerCase();
const words = value => normalize(value).match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [];
const wholeNames = new Map(), variants = new Map();
// Reuse pronunciations, not player identities. Every generated result remains a
// provisional transliteration, even when a same-spelling name is in the catalog.
for (const row of catalog) {
  const key = normalize(row.name).trim();
  wholeNames.set(key, row.name_ko);
  const latin = words(row.name), korean = row.name_ko.split(/\s+/u);
  if (latin.length !== korean.length) continue;
  latin.forEach((word, i) => {
    if (!/^[가-힣]+$/u.test(korean[i])) return;
    const options = variants.get(word) ?? new Map();
    options.set(korean[i], (options.get(korean[i]) ?? 0) + 1);
    variants.set(word, options);
  });
}
const lexicon = new Map([...variants].flatMap(([word, options]) => {
  const ranked = [...options].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.length === 1 || ranked[0][1] > ranked[1][1] ? [[word, ranked[0][0]]] : [];
}));
for (const [name,label] of [['Son Heung-min','손흥민'],['Heung-min Son','손흥민'],['Kim Min-jae','김민재'],['Min-jae Kim','김민재'],['Lee Kang-in','이강인'],['Kang-in Lee','이강인']]) wholeNames.set(normalize(name),label);
const initials = ['에이','비','시','디','이','에프','지','에이치','아이','제이','케이','엘','엠','엔','오','피','큐','알','에스','티','유','브이','더블유','엑스','와이','지'];
const onsets = { b:7,c:15,d:3,f:17,g:0,h:18,j:12,k:15,l:5,m:6,n:2,p:17,r:5,s:9,t:16,v:7,z:12,ch:14,sh:9,th:9,ng:11,ny:2,kw:15,ts:14 };
const bare = { b:'브',c:'크',d:'드',f:'프',g:'그',h:'흐',j:'지',k:'크',l:'르',m:'므',n:'느',p:'프',r:'르',s:'스',t:'트',v:'브',z:'즈',ch:'치',sh:'시',th:'스',ng:'응',ny:'니',kw:'쿠',ts:'츠' };
const vowels = { a:0,e:5,i:20,o:8,u:13,y:20,ai:1,ae:1,ay:7,ee:20,ei:7,ey:7,ie:20,oo:13,ou:13,oi:11,oy:11,au:8,ow:0,ya:2,ye:7,yo:12,yu:17,wa:9,we:10,wi:16,wo:14 };
const vowelAt = value => [value.slice(0,2),value[0]].find(k => Object.hasOwn(vowels,k));
function syllable(onset, vowel, coda=0) { return String.fromCharCode(0xac00 + (onset * 21 + vowel) * 28 + coda); }
function romanWord(word) {
  if (lexicon.has(word)) return lexicon.get(word);
  if (word.length === 1) return initials[word.charCodeAt(0)-97];
  if (/['’-]/u.test(word)) return word.split(/['’-]/u).map(romanWord).join('');
  let rest=word.replace(/ph/g,'f').replace(/tch/g,'ch').replace(/ck/g,'k').replace(/qu/g,'kw').replace(/gn/g,'ny').replace(/x/g,'ks').replace(/([bcdfghjklmnpqrstvwz])\1+/g,'$1'), result='';
  while (rest) {
    let vowel=vowelAt(rest), onset=11;
    if (!vowel) {
      const consonant=[rest.slice(0,2),rest[0]].find(k=>Object.hasOwn(onsets,k));
      if (!consonant) return null;
      rest=rest.slice(consonant.length); onset=onsets[consonant]; vowel=vowelAt(rest);
      if (!vowel) { result+=bare[consonant]; continue; }
    }
    rest=rest.slice(vowel.length); let coda=0;
    const ending = rest.startsWith('ng') ? 'ng' : /^[nlm]/u.test(rest) ? rest[0] : null;
    if (ending && (!rest.slice(ending.length) || !vowelAt(rest.slice(ending.length)))) {
      coda={n:4,l:8,m:16,ng:21}[ending]; rest=rest.slice(ending.length);
    }
    result+=syllable(onset,vowels[vowel],coda);
  }
  return result;
}

/** Approximate Latin spelling only; never label an inferred pronunciation as verified. */
export function transliteratePlayerName(player) {
  const raw = player.english?.trim() || player.name?.trim();
  if (!raw || raw.length > 160 || /[\x00-\x1f]/u.test(raw)) return null;
  if (/^[가-힣\s·-]+$/u.test(raw)) return raw.length <= 80 ? raw : null;
  const normalized=normalize(raw);
  if (wholeNames.has(normalized)) return wholeNames.get(normalized);
  // Unsupported scripts are retained as explicit audit misses, not fabricated identities.
  if (!/^[a-z\s.'’·-]+$/u.test(normalized)) return null;
  const tokens=words(raw), result=tokens.map(romanWord);
  if (!result.length || result.some(x=>!x)) return null;
  const label=result.join(' ');
  return label.length <= 80 && hasKoreanName(label) ? label : null;
}
