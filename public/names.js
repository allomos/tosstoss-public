'use strict';
// Device identity: a friendly name kept in this browser, and the device type.
(function () {
  const KEY = 'tosstoss.name';

  function detectDevice() {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPad|Tablet/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // A random friendly name in the page language: adjective + fruit.
  const WORDS = {
    zh: {
      adj: ['微笑的', '勇敢的', '安静的', '快乐的', '机灵的', '温柔的', '闪亮的', '好奇的', '悠闲的', '活泼的', '害羞的', '酷酷的', '慢吞吞的', '圆滚滚的', '爱笑的', '认真的'],
      noun: ['桃子', '西瓜', '橘子', '樱桃', '芒果', '柠檬', '葡萄', '菠萝', '草莓', '蓝莓', '椰子', '荔枝', '石榴', '香蕉', '猕猴桃', '山竹'],
      join: (a, n) => a + n,
    },
    en: {
      adj: ['Smiling', 'Brave', 'Quiet', 'Happy', 'Clever', 'Gentle', 'Shiny', 'Curious', 'Lazy', 'Lively', 'Shy', 'Cool', 'Sleepy', 'Chubby', 'Cheerful', 'Serious'],
      noun: ['Peach', 'Melon', 'Orange', 'Cherry', 'Mango', 'Lemon', 'Grape', 'Pineapple', 'Strawberry', 'Blueberry', 'Coconut', 'Lychee', 'Plum', 'Banana', 'Kiwi', 'Fig'],
      join: (a, n) => `${a} ${n}`,
    },
    ja: {
      adj: ['にこにこ', 'ゆうかんな', 'しずかな', 'たのしい', 'かしこい', 'やさしい', 'きらきら', 'ふしぎな', 'のんびり', 'げんきな', 'てれやの', 'クールな', 'ねぼすけ', 'まんまるの', 'ほがらかな', 'まじめな'],
      noun: ['もも', 'すいか', 'みかん', 'さくらんぼ', 'マンゴー', 'レモン', 'ぶどう', 'パイナップル', 'いちご', 'ブルーベリー', 'ココナッツ', 'ライチ', 'ざくろ', 'バナナ', 'キウイ', 'かき'],
      join: (a, n) => a + n,
    },
    es: {
      adj: ['Sonriente', 'Valiente', 'Tranquilo', 'Feliz', 'Listo', 'Amable', 'Brillante', 'Curioso', 'Perezoso', 'Alegre', 'Tímido', 'Genial', 'Dormilón', 'Redondo', 'Risueño', 'Serio'],
      noun: ['Melocotón', 'Melón', 'Mango', 'Limón', 'Plátano', 'Coco', 'Kiwi', 'Higo', 'Arándano', 'Pomelo', 'Dátil', 'Membrillo', 'Mandarino', 'Lichi', 'Albaricoque', 'Caqui'],
      join: (a, n) => `${n} ${a}`,
    },
  };
  const pick = (a) => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];

  function randomName() {
    const w = WORDS[window.I18n ? I18n.lang : 'zh'] || WORDS.zh;
    return w.join(pick(w.adj), pick(w.noun));
  }

  function load() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  function save(name) {
    try { localStorage.setItem(KEY, name); } catch { /* private mode: name lasts this visit */ }
  }

  let name = load();
  // Names from v0.1 looked like "设备 AB12"; give those a friendlier one.
  if (!name || /^设备 [A-Z0-9]{4}$/.test(name)) { name = randomName(); save(name); }

  window.Identity = {
    device: detectDevice(),
    get name() { return name; },
    setName(n) { name = n; save(n); },
  };
})();
