#!/usr/bin/env node
// Recategorizes all existing Supabase articles using the new scoring-based function.
// Usage: node scripts/recategorize.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function categorizeArticle(title, summary) {
  const text = ((title || '') + ' ' + (summary || '')).toLowerCase();

  const categories = {
    'Sport': [
      'f1', 'formula 1', 'formula one',
      'grand prix', 'mercedes', 'ferrari',
      'red bull racing', 'hamilton',
      'verstappen', 'russell', 'leclerc',
      'football', 'cricket', 'tennis',
      'golf', 'rugby', 'basketball',
      'world cup', 'olympics', 'champion',
      'premier league', 'la liga',
      'uae pro league', 'al ain', 'al jazira',
      'shabab al ahli', 'dubai fc',
      'horse racing', 'dubai world cup',
      'marathon', 'cycling', 'triathlon',
      'match', 'score', 'goal', 'wicket',
      'player', 'coach', 'stadium',
      'transfer', 'athlete', 'podium',
      'race', 'qualifying', 'driver',
      'constructor', 'gp', 'motogp',
      'wimbledon', 'ufc', 'boxing',
      'strade bianche', 'tour de france',
    ],
    'World': [
      'iran', 'israel', 'lebanon',
      'saudi arabia', 'qatar', 'kuwait',
      'bahrain', 'oman', 'egypt', 'jordan',
      'syria', 'iraq', 'yemen', 'gaza',
      'palestine', 'hamas', 'hezbollah',
      'gcc', 'arab league', 'opec',
      'strikes', 'missile', 'conflict',
      'war', 'ceasefire', 'sanctions',
      'diplomatic', 'ambassador',
      'regional', 'international',
      'global', 'foreign minister',
      'un security', 'nato', 'pentagon',
      'kremlin', 'white house',
      'suspend', 'attack on', 'invasion',
      'troops', 'military operation',
    ],
    'Safety': [
      'police', 'dubai police',
      'abu dhabi police', 'crime', 'arrest',
      'wanted', 'suspect', 'safety',
      'security alert', 'warning',
      'emergency', 'fire', 'explosion',
      'flood', 'danger', 'robbery',
      'fraud', 'scam', 'assault',
      'traffic accident', 'fatality',
      'civil defence', 'rescue',
    ],
    'Government': [
      'sheikh', 'his highness', 'ruler',
      'crown prince', 'president of uae',
      'vice president', 'prime minister uae',
      'minister announced', 'ministry of',
      'federal authority', 'municipality',
      'law passed', 'new decree',
      'cabinet meeting', 'uae vision',
      'uae strategy', 'official visit',
    ],
    'Business': [
      'economy', 'gdp', 'inflation',
      'stock market', 'dfm', 'adx',
      'difc', 'adgm', 'bank', 'investment',
      'real estate', 'property market',
      'startup funding', 'ipo', 'merger',
      'revenue', 'profit', 'quarterly',
      'oil price', 'crude', 'barrel',
      'gold price', 'dirham exchange',
      'retail sales', 'tourism revenue',
    ],
    'Transport': [
      'rta', 'dubai metro', 'tram',
      'bus route', 'taxi', 'careem',
      'dxb airport', 'auh airport',
      'emirates airline', 'etihad',
      'flydubai', 'air arabia',
      'flight delay', 'flight cancel',
      'visa update', 'entry requirement',
      'traffic jam', 'road closure',
      'new bridge', 'new road', 'salik',
      'toll gate', 'speed camera',
    ],
    'Health': [
      'dha', 'mohap', 'hospital',
      'clinic', 'doctor', 'patient',
      'surgery', 'vaccine', 'virus',
      'disease', 'outbreak', 'epidemic',
      'cancer', 'diabetes', 'heart disease',
      'mental health', 'health warning',
      'medical', 'treatment', 'drug approved',
      'health insurance', 'pharmaceutical',
    ],
    'Education': [
      'school', 'university', 'college',
      'khda', 'adek', 'gems', 'taaleem',
      'student', 'teacher', 'exam',
      'curriculum', 'admission',
      'scholarship', 'academic',
      'school closure', 'school holiday',
      'graduation', 'e-learning',
    ],
    'Weather': [
      'weather', 'temperature', 'humidity',
      'rain', 'rainfall', 'storm',
      'thunder', 'lightning', 'fog',
      'dust storm', 'sandstorm', 'wind',
      'heat wave', 'cold front', 'ncm',
      'national centre of meteorology',
      'forecast', 'degrees celsius',
      'uv index', 'sunny', 'cloudy',
    ],
    'Technology': [
      'artificial intelligence', ' ai ',
      'machine learning', 'robotics',
      'cybersecurity', 'data breach',
      'hacking', '5g network', 'blockchain',
      'cryptocurrency', 'bitcoin', 'nft',
      'gitex', 'tech startup', 'coding',
      'cloud computing', 'metaverse',
      'smart city tech', 'autonomous vehicle',
      'digital transformation', 'app launch',
      'software update', 'iphone', 'android',
    ],
    'Lifestyle': [
      'restaurant', 'cafe', 'dining',
      'hotel', 'resort', 'spa', 'luxury',
      'shopping mall', 'fashion week',
      'concert', 'festival', 'event',
      'movie', 'cinema', 'music festival',
      'art exhibition', 'museum',
      'travel guide', 'staycation',
      'beach club', 'hiking trail',
      'fitness', 'yoga', 'wellness',
    ],
    'Community': [
      'expat', 'resident visa', 'golden visa',
      'citizenship', 'passport renewal',
      'charity', 'volunteer', 'donation',
      'mosque', 'church', 'temple',
      'ramadan', 'eid', 'diwali',
      'christmas', 'cultural event',
      'cost of living', 'rent increase',
      'housing', 'community initiative',
    ],
  };

  const scores = {};
  for (const [category, keywords] of Object.entries(categories)) {
    scores[category] = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword)) scores[category]++;
    }
  }

  const priority = [
    'Sport', 'World', 'Safety',
    'Government', 'Transport', 'Health',
    'Education', 'Weather', 'Business',
    'Community', 'Lifestyle', 'Technology',
  ];

  let bestCategory = 'General';
  let highestScore = 0;
  for (const category of priority) {
    if (scores[category] > highestScore) {
      highestScore = scores[category];
      bestCategory = category;
    }
  }

  return bestCategory;
}

async function main() {
  console.log('Fetching all articles from Supabase...');

  // Fetch in pages of 1000
  let allArticles = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, calm_headline, summary, original_title, category')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) { console.error('Fetch error:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allArticles = allArticles.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  console.log(`Fetched ${allArticles.length} articles total.`);

  // Re-categorize and collect updates
  const examples = [];
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const article of allArticles) {
    const newCat = categorizeArticle(
      article.calm_headline || article.original_title || '',
      article.summary || ''
    );
    const oldCat = article.category || '(none)';

    if (newCat !== oldCat) {
      updatedCount++;
      if (examples.length < 5) {
        examples.push({
          title: (article.calm_headline || article.original_title || '').slice(0, 80),
          before: oldCat,
          after: newCat,
        });
      }

      const { error } = await supabase
        .from('articles')
        .update({ category: newCat })
        .eq('id', article.id);

      if (error) console.error(`Update failed for ${article.id}:`, error.message);
    } else {
      unchangedCount++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  Updated : ${updatedCount}`);
  console.log(`  Unchanged: ${unchangedCount}`);
  console.log(`\nBefore → After examples:`);
  for (const ex of examples) {
    console.log(`  "${ex.title}"`);
    console.log(`    ${ex.before} → ${ex.after}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
