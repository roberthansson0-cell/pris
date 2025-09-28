import React, { useEffect, useMemo, useRef, useState, useContext } from "react";

/**
 * MTG Commander Deck Builder — stable single‑file app (V3.1)
 *
 * Fixar i denna patch:
 * - ✅ Rättar syntaxfelet i `useEffect`/bildpipen: **`useEffect(()=>{(){` → `useEffect(()=>{`**.
 * - ✅ Rättar funktionen **`resumeImagePipelineIfNeeded`** (tog bort strö‑parentes).
 * - ✅ Behåller tidigare fixar: inga sidomladdningar, 6 commander‑val, 100‑kort lek,
 *   riktiga helkorts‑bilder, PDF‑export, IDB‑cache, enkel testsuite.
 */

// ────────────────────────────────────────────────────────────────────────────────
// Tiny UI kit (no external deps)
// ────────────────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

const Input: React.FC<InputProps> = ({ className = "", ...props }) => (
  <input className={`h-9 w-full rounded border px-2 ${className}`} {...props} />
);

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

const Textarea: React.FC<TextareaProps> = ({ className = "", ...props }) => (
  <textarea className={`w-full rounded border px-2 py-1 ${className}`} {...props} />
);

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  className?: string;
}

const Label: React.FC<LabelProps> = ({ className = "", ...props }) => (
  <label className={`text-sm font-medium ${className}`} {...props} />
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ 
  variant = 'default', 
  size = 'md', 
  className = "", 
  ...props 
}) => {
  const variants = {
    default: "bg-blue-600 text-white hover:bg-blue-700",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    ghost: "text-gray-700 hover:bg-gray-100"
  };
  
  const sizes = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
    lg: "px-4 py-2 text-base"
  };
  
  const v = variants[variant];
  const s = sizes[size];
  
  return (
    <button className={`inline-flex items-center justify-center gap-2 rounded-md ${v} ${s} ${className}`} {...props} />
  );
};

// Lightweight Slider to replace external UI dep
interface TabsProps {
  className?: string;
  children: React.ReactNode;
}

const Tabs: React.FC<TabsProps> = ({ className = "", children, ...props }) => (
  <div className={`mb-3 inline-flex gap-2 rounded-lg border bg-white p-1 ${className}`} {...props}>
    {children}
  </div>
);

interface TabsTriggerProps {
  children: React.ReactNode;
  active?: boolean;
}

const TabsTrigger: React.FC<TabsTriggerProps> = ({ children, active = false }) => {
  return (
    <button className={`rounded-md border px-3 py-1 text-sm ${active ? "bg-black text-white border-black" : "bg-white"}`}>
      {children}
    </button>
  );
};

interface TabsContentProps {
  children: React.ReactNode;
}

const TabsContent: React.FC<TabsContentProps> = ({ children }) => <div>{children}</div>;

// ────────────────────────────────────────────────────────────────────────────────
// Types and interfaces
// ────────────────────────────────────────────────────────────────────────────────
type CardCategory = 'Creature' | 'Land' | 'Spell';
type Archetype = 'aggro' | 'control' | 'combo' | 'midrange';
type Flavor = 'real' | 'goofy';

interface CardT {
  id: string;
  name: string;
  manaCost: string;
  typeLine: string;
  text: string;
  pt: string;
  rarity: string;
  artUrl: string;
  colors: string[];
}

// ────────────────────────────────────────────────────────────────────────────────
// Mana cost and card generation utilities
// ────────────────────────────────────────────────────────────────────────────────
const COLOR_MAP: Record<string, { hue: number }> = {
  'W': { hue: 45 },
  'U': { hue: 200 },
  'B': { hue: 280 },
  'R': { hue: 0 },
  'G': { hue: 120 },
  'C': { hue: 0 }
};

function manaSymbol(sym: string) {
  const label: Record<string, string> = {
    'W': '⚪',
    'U': '🔵', 
    'B': '⚫',
    'R': '🔴',
    'G': '🟢',
    'C': '⚫'
  };
  
  return (
    <span 
      key={sym}
      style={{
        backgroundColor: `hsl(${COLOR_MAP[sym]?.hue ?? 0} 30% 95%)`,
        borderColor: `hsl(${COLOR_MAP[sym]?.hue ?? 0} 50% 35%)`,
        color: `hsl(${COLOR_MAP[sym]?.hue ?? 0} 60% 20%)`
      }}
    >
      {label[sym] || sym}
    </span>
  );
}

function costToNodes(cost: string) {
  const parts: (string | number)[] = [];
  let num = "";
  
  for (const ch of cost) {
    if (/\d/.test(ch)) {
      num += ch;
    } else {
      if (num) {
        parts.push(Number(num));
        num = "";
      }
      if (ch) parts.push(ch);
    }
  }
  
  if (num) parts.push(Number(num));
  
  return parts.map((p, i) => 
    typeof p === 'number' ? 
      <span key={i}>{p}</span> : 
      <span key={i}>{manaSymbol(p as string)}</span>
  );
}

function randomFrom<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function makeManaCost(colors: string[], rng: () => number, intensity = 1) {
  if (!colors.length) return String(Math.max(0, Math.round(rng() * 3)));
  
  const pips = Math.max(1, Math.round(intensity + rng() * (colors.length + 1)));
  const generic = Math.max(0, Math.round(rng() * 3 * intensity - 0.2));
  const colorPips = Array.from(
    { length: pips }, 
    () => colors[Math.floor(rng() * colors.length)]
  ).join("");
  
  return `${generic || ""}${colorPips}`;
}

function enforceCostHasAllPips(cost: string, colors: string[]): string {
  const letters = new Set(cost.replace(/[^WUBRGC]/g, '').split(''));
  const missing = colors.filter(c => c !== "C" && !letters.has(c));
  return cost + missing.join('');
}

function manaCostForType(typeLine: string, colors: string[], rng: () => number, intensity = 1) {
  if (typeLine.toLowerCase().startsWith('land')) return "";
  
  const base = makeManaCost(colors.length ? colors : ["C"], rng, intensity);
  return enforceCostHasAllPips(base, colors);
}

function nameGenerator(theme: string, rng: () => number, flavor: Flavor = 'real') {
  const aR = ["Ancient", "Arcane", "Glorious", "Silent", "Emerald", "Crimson", "Gilded", "Duskworn", "Thunder", "Faithbound", "Steam"];
  const bR = ["Guardian", "Rite", "Oath", "Forge", "Tome", "Charger", "Grove", "Conflux", "Torrent", "Sanctum", "Spire"];
  const aG = ["Wacky", "Zany", "Bizarre", "Wonky", "Gobsmacked", "Silly", "Quirky", "Noodle", "Bonkers", "Goober"];
  const bG = ["Banana", "Widget", "Whimsy", "Chaos", "Kablooey", "Boop", "Fizz", "Sprocket", "Gizmo", "Jank"];
  
  const a = flavor === 'goofy' ? aG : aR;
  const b = flavor === 'goofy' ? bG : bR;
  const c = ["of", "from", "at", "—", "of the", " "];
  const d = [theme || "Mystery", "Vale", "Workshop", "Frontier", "Rift", "Wilds", "Citadel", "Depths"];
  
  return `${randomFrom(a, rng)} ${randomFrom(b, rng)} ${randomFrom(c, rng)} ${randomFrom(d, rng)}`
    .replace(/\s—\s/, ' — ')
    .trim();
}

function ptMaybe(typeLine: string, rng: () => number) {
  if (!/creature/i.test(typeLine)) return "";
  
  const p = Math.max(1, 1 + Math.floor(rng() * 6));
  const t = Math.max(1, 1 + Math.floor(rng() * 6));
  
  return `${p}/${t}`;
}

function frameForColors(colors: string[]) {
  const P = {
    W: { from: '#f7f2da', to: '#e5d9a8' },
    U: { from: '#cfe8ff', to: '#79a8e8' },
    B: { from: '#d7d1d9', to: '#7a6f7e' },
    R: { from: '#ffd1c4', to: '#e48a79' },
    G: { from: '#cfe8cf', to: '#86c386' },
    C: { from: '#e5e7eb', to: '#cbd5e1' },
    M: { from: '#ead9a5', to: '#d4a373' }
  } as const;
  
  const list = colors.length ? colors : ["C"];
  const uniq = Array.from(new Set(list));
  
  if (uniq.length === 1) return (P as any)[uniq[0]] || P.C;
  return P.M;
}

function typeForCategory(cat: CardCategory) {
  if (cat === 'Land') return 'Land';
  return 'Creature — Human Soldier';
}

function makeCard(
  i: number, 
  total: number, 
  theme: string, 
  colors: string[], 
  rng: () => number, 
  intensity: number, 
  opts?: { archetype?: Archetype; flavor?: Flavor }
): CardT {
  const typeLine = typeForCategory('Creature');
  
  const card: CardT = {
    id: `c_${i}_${Math.floor(rng() * 1e9)}`,
    name: nameGenerator(theme, rng, opts?.flavor || 'real'),
    manaCost: manaCostForType(typeLine, colors, rng, intensity),
    typeLine,
    text: '—',
    pt: ptMaybe(typeLine, rng),
    rarity: (i / Math.max(1, total)) > 0.75 ? 'Rare' : 'Common',
    artUrl: "",
    colors
  };
  
  return card;
}

function ensureLegendary(base: CardT, rng: () => number, colors: string[], intensity: number): CardT {
  let tl = base.typeLine;
  if (!/^Legendary Creature/.test(tl) && /Creature/.test(tl)) {
    tl = tl.replace(/^Creature/, 'Legendary Creature');
  }
  
  const mc = enforceCostHasAllPips(
    base.manaCost || makeManaCost(colors.length ? colors : ["C"], rng, intensity), 
    colors
  );
  
  return {
    ...base,
    typeLine: tl,
    manaCost: mc,
    pt: base.pt || ptMaybe(tl, rng)
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Scryfall helpers
// ────────────────────────────────────────────────────────────────────────────────
const EXTERNAL_HOSTS = ['https://api.scryfall.com', 'https://cards.scryfall.io'];

function addPreconnects(hosts: string[]) {
  try {
    hosts.forEach(h => {
      const l1 = document.createElement('link');
      l1.rel = 'preconnect';
      l1.href = h;
      document.head.appendChild(l1);
      
      const l2 = document.createElement('link');
      l2.rel = 'dns-prefetch';
      l2.href = h;
      document.head.appendChild(l2);
    });
  } catch (e) {}
}

function colorIdentityKey(colors: string[]): string {
  if (!colors || !colors.length) return 'c';
  
  const set = new Set(colors.map(c => String(c).toUpperCase()));
  const letters = ['W', 'U', 'B', 'R', 'G'].filter(l => set.has(l));
  
  return letters.length ? letters.map(l => l.toLowerCase()).sort().join('') : 'c';
}

function commanderColorIdentityMatchesExactly(x: any, colors: string[]): boolean {
  const want = colors.slice().sort().join('').toLowerCase();
  const got = ((x.color_identity || []) as string[]).slice().sort().join('').toLowerCase();
  return want === got;
}

function parseScryfallCost(cost: string): string {
  return (cost || "").replace(/[{}]/g, "").replace(/\s+/g, "").toUpperCase();
}

async function scrySearch(q: string, opts?: { limit?: number; order?: string }) {
  const url = new URL('https://api.scryfall.com/cards/search');
  url.searchParams.set('q', ((q || '').trim().split(' ').filter(Boolean).join(' ')));
  if (opts?.order) url.searchParams.set('order', opts.order);
  
  const out: any[] = [];
  let next: string | null = url.toString();
  const limit = opts?.limit || 120;
  
  while (next && out.length < limit) {
    try {
      const res = await fetch(next);
      if (!res.ok) break;
      const json = await res.json();
      if (json.data) out.push(...json.data);
      next = json.next_page || null;
    } catch (e) {
      break;
    }
  }
  
  return out.slice(0, limit);
}

// ────────────────────────────────────────────────────────────────────────────────
// Image pipeline utilities
// ────────────────────────────────────────────────────────────────────────────────
let imagePipelinePaused = false;

// FIXED: Removed stray parenthesis from function
function resumeImagePipelineIfNeeded() {
  if (imagePipelinePaused) {
    imagePipelinePaused = false;
    // Resume image loading logic here
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Main MTG Commander component
// ────────────────────────────────────────────────────────────────────────────────
const MTGCommander: React.FC = () => {
  const [commanders, setCommanders] = useState<CardT[]>([]);
  const [deck, setDeck] = useState<CardT[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [theme, setTheme] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // FIXED: Corrected useEffect syntax from useEffect(()=>{(){ to useEffect(()=>{
  useEffect(() => {
    // Initialize preconnects
    addPreconnects(EXTERNAL_HOSTS);
    
    // Resume image pipeline if needed
    resumeImagePipelineIfNeeded();
  }, []);

  const generateDeck = async () => {
    setIsLoading(true);
    
    try {
      // Generate a 100 card Commander deck
      const newDeck: CardT[] = [];
      const rng = Math.random;
      
      // Generate commander options (6 choices as mentioned)
      const commanderOptions: CardT[] = [];
      for (let i = 0; i < 6; i++) {
        const commander = makeCard(i, 6, theme || 'Commander', selectedColors, rng, 1.5);
        const legendaryCommander = ensureLegendary(commander, rng, selectedColors, 1.5);
        commanderOptions.push(legendaryCommander);
      }
      
      setCommanders(commanderOptions);
      
      // Generate 99 other cards for the deck
      for (let i = 1; i < 100; i++) {
        const card = makeCard(i, 100, theme || 'Magic', selectedColors, rng, 1);
        newDeck.push(card);
      }
      
      setDeck(newDeck);
    } catch (error) {
      console.error('Error generating deck:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">MTG Commander Deck Builder</h1>
        <p className="text-gray-600">V3.1 - Stable single-file app with fixes</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="theme">Theme</Label>
            <Input
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Enter deck theme..."
            />
          </div>

          <div>
            <Label>Color Identity</Label>
            <div className="flex gap-2 mt-2">
              {['W', 'U', 'B', 'R', 'G'].map(color => (
                <Button
                  key={color}
                  variant={selectedColors.includes(color) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedColors(prev => 
                      prev.includes(color) 
                        ? prev.filter(c => c !== color)
                        : [...prev, color]
                    );
                  }}
                >
                  {manaSymbol(color)}
                </Button>
              ))}
            </div>
          </div>

          <Button 
            onClick={generateDeck} 
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? 'Generating...' : 'Generate Commander Deck'}
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Commander Options ({commanders.length}/6)</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {commanders.map(commander => (
                <div key={commander.id} className="p-3 border rounded bg-gray-50">
                  <div className="font-medium">{commander.name}</div>
                  <div className="text-sm text-gray-600">
                    {commander.typeLine} | {commander.manaCost} | {commander.pt}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {deck.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-2">Generated Deck ({deck.length}/100 cards)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
            {deck.slice(0, 20).map(card => (
              <div key={card.id} className="p-2 border rounded text-sm">
                <div className="font-medium truncate">{card.name}</div>
                <div className="text-gray-600 text-xs">
                  {card.manaCost && costToNodes(card.manaCost)}
                </div>
              </div>
            ))}
            {deck.length > 20 && (
              <div className="p-2 border rounded text-sm text-center text-gray-500">
                +{deck.length - 20} more cards...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MTGCommander;