// quick check that hero-side HTML includes thumbnail markup
const items=[
  {
    id:'a', imageUrl:'https://example.com/foo.jpg', topic:'news', calmTitle:'First', calmSummary:'', publishedAt:'2026-03-03', sourceName:'test'
  },
  {
    id:'b', imageUrl:'https://example.com/bar.jpg', topic:'health', calmTitle:'Second', calmSummary:'', publishedAt:'2026-03-03', sourceName:'test'
  }
];

function gradientForTopic(topic){return 'grad';}
function relativeTime(i){return 'time';}

const sidesHTML = items.slice(1, 3).map((item, i) => `
  <div class="side-story" onclick="location.href='article.html?id=${encodeURIComponent(item.id)}'">
    <div class="side-thumb">
      ${item.imageUrl ? `<img src="/api/image?url=${encodeURIComponent(item.imageUrl)}" alt="" />` : ``}
      <div class="side-number">0${i + 2}</div>
    </div>
    <div class="side-text">
      <div class="side-category">${item.topic.toUpperCase()}</div>
      <h3 class="side-title">${item.calmTitle || item.title}</h3>
      <p class="side-deck">${item.calmSummary || ''}</p>
      <div class="side-time">${relativeTime(item.publishedAt)}</div>
    </div>
  </div>
`).join('');

console.log(sidesHTML);
