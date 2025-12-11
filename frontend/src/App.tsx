import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FlaskConical,
  Tag,
  Lightbulb,
  FileText,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  XCircle,
  AlertTriangle,
  Settings,
  Filter,
} from 'lucide-react';
// NOTE: duplicated definitions in this file are legacy; imports kept only where referenced.

// --- Configuration & Types ---

const API_BASE_URL = "http://localhost:8000";

// Color Palette
const COLORS = {
  primary: '#0573bb',
  primaryHover: '#0a8bdf',
  background: '#f4f7fb',
  surface: '#ffffff',
  border: '#d7e1ed',
  textPrimary: '#1f2a37',
  textSecondary: '#4c5d73',
  success: '#1b9e5f',
  warning: '#f2a141',
  error: '#c23a3a',
};

// Simple HTML entity decoder for Etsy-escaped text
const decodeHtmlEntities = (input: string | null | undefined): string => {
  if (!input) return '';
  if (typeof document === 'undefined') {
    // Fallback for non-browser environments
    return input
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = input;
  return textarea.value;
};

// Types based on Backend Models
interface ListingPreview {
  listing_id: number;
  title: string;
  title_30: string;
  state: string;
  primary_image_url: string | null;
}

interface ExperimentRecord {
  listing_id: number;
  experiment_id: string;
  state: string;
  change_types?: string[];
  start_date?: string;
  end_date?: string;
  planned_end_date?: string;
  run_duration_days?: number;
  model_used?: string;
  performance?: {
    baseline?: any;
    latest?: {
      normalized_delta?: number;
      views?: number;
      confidence?: number;
    };
  };
  preview: ListingPreview;
}

interface ProposalOption {
  experiment_id: string;
  change_type: string;
  hypothesis: string;
  payload: any;
}

interface OverviewStats {
  active_experiments: {
    count: number;
    best?: { preview: ListingPreview; normalized_delta: number };
    worst?: { preview: ListingPreview; normalized_delta: number };
  };
  finished_experiments: {
    count: number;
    best?: { preview: ListingPreview; normalized_delta: number };
    worst?: { preview: ListingPreview; normalized_delta: number };
  };
  proposals: { count: number };
  insights: { active_count: number };
  completed: {
    count: number;
    percent_kept: number;
    avg_normalized_delta_kept: number;
  };
}

interface Report {
  report_id: string;
  created_at: string;
  window_start: string;
  window_end: string;
  report_markdown: string;
  insights: any[];
}

interface Insight {
  insight_id: string;
  text: string;
  reasoning: string;
  report_id?: string;
}

// --- API Helpers (kept here for now; duplicated in src/api.ts while we gradually migrate) ---

const api = {
  get: async (endpoint: string) => {
    const res = await fetch(`${API_BASE_URL}${endpoint}`);
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return res.json();
  },
  post: async (endpoint: string, body: any = {}) => {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return res.json();
  },
  delete: async (endpoint: string) => {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return res.json();
  },
};

const getImageUrl = (path: string | null) => {
  if (!path) return "https://placehold.co/100x100?text=No+Img";
  return path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
};

// --- Components ---

const Button = ({
  children, onClick, variant = 'primary', size = 'md', className = '', disabled = false, loading = false 
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'success'; 
  size?: 'sm' | 'md' | 'lg'; 
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) => {
  const baseStyle = "font-sans font-medium rounded transition-colors duration-200 flex items-center justify-center gap-2";
  const variants = {
    primary:
      'bg-[#0573bb] text-white hover:bg-[#0a8bdf] disabled:opacity-50',
    secondary:
      'bg-[#f4f7fb] text-[#1f2a37] hover:bg-gray-200',
    outline:
      'border border-[#d7e1ed] text-[#1f2a37] hover:bg-gray-50 bg-white',
    danger:
      'bg-[#c23a3a] text-white hover:bg-red-700',
    success:
      'bg-[#1b9e5f] text-white hover:bg-green-700',
  };
  const sizes = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled || loading}
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded border border-[${COLORS.border}] shadow-sm p-4 ${className}`}>
    {children}
  </div>
);

const Badge = ({ children, color = 'gray' }: { children: React.ReactNode; color?: 'gray' | 'blue' | 'green' | 'red' | 'yellow' }) => {
  const colors = {
    gray: "bg-gray-100 text-gray-800",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    yellow: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
};

const ListingThumbnail = ({
  preview,
  onClick,
}: {
  preview: ListingPreview;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}) => (
  <div 
    className="flex items-center gap-3 cursor-pointer group hover:opacity-80 transition-opacity"
    onClick={onClick}
  >
    <img 
      src={getImageUrl(preview.primary_image_url)} 
      alt={decodeHtmlEntities(preview.title)} 
      className="w-12 h-12 object-cover rounded border border-gray-200"
    />
    <div>
      <h4
        className="font-sans text-sm font-medium text-gray-900 group-hover:text-[color:var(--primary)] max-w-xs leading-snug line-clamp-2"
        style={{ '--primary': COLORS.primary } as any}
      >
        {decodeHtmlEntities(preview.title)}
      </h4>
      <span className="text-xs text-gray-500">ID: {preview.listing_id}</span>
    </div>
  </div>
);

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="font-serif text-lg font-bold">{title}</h3>
          <button onClick={onClose}><XCircle className="text-gray-400 hover:text-gray-600" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};

// --- Pages ---

// 1. Overview Page
const Overview = ({ navigate }: { navigate: (page: string, params?: any) => void }) => {
  const [data, setData] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/overview').then(setData).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return <div className="p-8 text-center text-gray-500">Loading Overview...</div>;

  const StatCard = ({ title, count, onClick, subtext, metric, icon: Icon }: any) => (
    <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
      <div onClick={onClick} className="h-full flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold text-gray-700">
            {title}
          </h3>
          {Icon && (
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-500">
              <Icon size={16} />
            </span>
          )}
        </div>
        <div
          className="text-4xl font-bold mb-1"
          style={{ color: COLORS.primary }}
        >
          {count}
        </div>
        {metric}
        {subtext && (
          <p className="text-xs text-gray-500 mt-auto flex items-center gap-1">
            {subtext}
            <ArrowRight className="w-3 h-3" />
          </p>
        )}
      </div>
    </Card>
  );

  const PerformanceCard = ({ label, item, type }: { label: string, item: any, type: 'best' | 'worst' }) => {
    if (!item) return null;
    return (
      <div className={`mt-2 p-2 rounded ${type === 'best' ? 'bg-green-50' : 'bg-red-50'} border border-opacity-20 ${type === 'best' ? 'border-green-500' : 'border-red-500'}`}>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs font-bold uppercase ${type === 'best' ? 'text-green-700' : 'text-red-700'}`}>{label}</span>
          <span className="text-xs font-mono">{item.normalized_delta > 0 ? '+' : ''}{(item.normalized_delta * 100).toFixed(1)}%</span>
        </div>
        <ListingThumbnail preview={item.preview} onClick={() => navigate('listing', { id: item.preview.listing_id })} />
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="font-serif text-3xl font-bold text-gray-900">
            Dashboard Overview
          </h1>
          <p className="text-sm text-gray-500">
            High-level view of experiments, proposals, and insights across your shop.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            Experiments live
          </span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Active Experiments */}
        <div className="flex flex-col gap-4">
          <StatCard 
            title="Active Experiments" 
            count={data.active_experiments.count} 
            onClick={() => navigate('experiments', { tab: 'active' })}
            subtext="View currently running tests"
            icon={FlaskConical}
          />
          {(data.active_experiments.best || data.active_experiments.worst) && (
            <Card className="flex-1">
              <h4 className="font-serif font-bold text-sm mb-2">Performance Watch</h4>
              <PerformanceCard label="Best Performing" item={data.active_experiments.best} type="best" />
              <PerformanceCard label="Worst Performing" item={data.active_experiments.worst} type="worst" />
            </Card>
          )}
        </div>

        {/* Finished Experiments */}
        <div className="flex flex-col gap-4">
          <StatCard 
            title="Finished" 
            count={data.finished_experiments.count} 
            onClick={() => navigate('experiments', { tab: 'finished' })}
            subtext="Experiments ready to resolve"
            icon={FlaskConical}
          />
           {(data.finished_experiments.best || data.finished_experiments.worst) && (
            <Card className="flex-1">
               <h4 className="font-serif font-bold text-sm mb-2">Results In</h4>
              <PerformanceCard label="Best Performing" item={data.finished_experiments.best} type="best" />
              <PerformanceCard label="Worst Performing" item={data.finished_experiments.worst} type="worst" />
            </Card>
          )}
        </div>

        {/* Operational Stats */}
        <StatCard 
          title="Active Insights" 
          count={data.insights.active_count} 
          onClick={() => navigate('insights')}
          subtext="Signals currently driving generation"
          icon={Lightbulb}
        />
        
        <StatCard 
          title="Proposals" 
          count={data.proposals.count} 
          onClick={() => navigate('experiments', { tab: 'proposals' })}
          subtext="New experiment ideas to review"
          icon={Tag}
        />
      </div>

      {/* Completed Metrics */}
      <Card className="bg-gradient-to-br from-[#0573bb] to-[#0a8bdf] text-white border-none">
        <h3 className="font-serif text-xl font-bold mb-4">Completed Experiments</h3>
        <div className="flex flex-wrap gap-12">
          <div>
            <div className="text-3xl font-bold">{data.completed.count}</div>
            <div className="text-sm opacity-80">Total Run</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{(data.completed.percent_kept || 0).toFixed(1)}%</div>
            <div className="text-sm opacity-80">Percent Kept</div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {data.completed.avg_normalized_delta_kept > 0 ? '+' : ''}
              {((data.completed.avg_normalized_delta_kept || 0) * 100).toFixed(1)}%
            </div>
            <div className="text-sm opacity-80">Avg. Increase (Kept)</div>
          </div>
        </div>
      </Card>
    </div>
  );
};

// 2. Experiments Page
const ExperimentsPage = ({ initialTab = 'active', navigate }: { initialTab?: string, navigate: any }) => {
  const [tab, setTab] = useState(initialTab);
  const [boardData, setBoardData] = useState<any>(null);
  const [, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Search/Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Inactive Selection
  const [selectedInactive, setSelectedInactive] = useState<number[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingCount, setGeneratingCount] = useState(0);

  // Accordion States
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedProposals, setExpandedProposals] = useState<Set<number>>(new Set());
  const [selectedProposalOptions, setSelectedProposalOptions] = useState<Record<number, string>>({});
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [showOriginalDescriptions, setShowOriginalDescriptions] = useState<Set<string>>(new Set());

  const [settings, setSettings] = useState({
    run_duration_days: 30,
    generation_model: 'gpt-5.1',
    reasoning_level: 'low',
  });

  // End Early / Resolve Modal State
  const [resolveModal, setResolveModal] = useState<{ isOpen: boolean, listingId?: number, experimentId?: string, type: 'end_early' | 'resolve' | null, stats?: any }>({ isOpen: false, type: null });

  // Keep internal tab state in sync with router-driven initialTab
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/experiments/board?search=${searchTerm}`);
      setBoardData(data);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, refreshTrigger]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const refresh = () => setRefreshTrigger(p => p + 1);

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedItems(newSet);
  };

  // Actions
  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratingCount(selectedInactive.length);
    // Optimistic Update: Move selected to generating visual state
    // For MVP we just wait for API.
    try {
      await api.post('/experiments/proposals', {
        listing_ids: selectedInactive,
        run_duration_days: settings.run_duration_days,
        generation_model: settings.generation_model,
        reasoning_level: settings.reasoning_level,
      });
      setSelectedInactive([]);
      refresh();
      // Auto switch to proposals and keep URL in sync
      setTab('proposals');
      navigate('experiments', { tab: 'proposals' });
    } catch (e) {
      alert('Failed to generate proposals');
    } finally {
      setIsGenerating(false);
      setGeneratingCount(0);
    }
  };

  const handleApplyProposal = async (listingId: number, experimentId: string) => {
    try {
      // Optimistic remove
      if (boardData) {
        setBoardData({
          ...boardData,
          proposals: {
            ...boardData.proposals,
            results: boardData.proposals.results.filter((r: any) => r.listing_id !== listingId)
          }
        });
      }
      await api.post(`/experiments/proposals/${listingId}/select`, { experiment_id: experimentId });
      refresh();
    } catch (e) {
      alert("Error starting experiment");
      refresh();
    }
  };

  const handleRegenerate = async (listingId: number) => {
    try {
      await api.post(`/experiments/proposals/${listingId}/regenerate`, {
        run_duration_days: settings.run_duration_days,
        generation_model: settings.generation_model,
        reasoning_level: settings.reasoning_level,
      });
      refresh();
    } catch (e) { alert("Failed"); }
  };

  const handleResolveAction = async (action: 'keep' | 'revert' | 'extend' | 'continue') => {
    const { listingId, experimentId } = resolveModal;
    if (!listingId || !experimentId) return;

    try {
      if (action === 'continue') {
        setResolveModal({ isOpen: false, type: null });
        return;
      }

      if (action === 'extend') {
        const days = prompt("How many days to extend?", "7");
        if (!days) return;
        await api.post(`/experiments/${listingId}/${experimentId}/extend`, { additional_days: parseInt(days) });
      } else {
        await api.post(`/experiments/${listingId}/${experimentId}/${action}`);
      }
      
      setResolveModal({ isOpen: false, type: null });
      // Optimistic update would be complex here, so we rely on refresh
      refresh();
    } catch (e) { alert("Failed to resolve"); }
  };

  const openResolveModal = (listingId: number, experimentId: string, type: 'end_early' | 'resolve', stats: any) => {
    setResolveModal({ isOpen: true, listingId, experimentId, type, stats });
  };

  const TabButton = ({ id, label, count }: any) => (
    <button
      onClick={() => {
        setTab(id);
        navigate('experiments', { tab: id });
      }}
      className={`px-4 py-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors flex-1 justify-center
        ${tab === id ? `border-[${COLORS.primary}] text-[${COLORS.primary}]` : 'border-transparent text-gray-500 hover:text-gray-700'}
      `}
    >
      {label}
      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{count || 0}</span>
    </button>
  );

  const SortDropdown = () => (
    <div className="relative inline-block text-left ml-4">
      <button 
        onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
        className="flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <Filter className="w-4 h-4 mr-1" />
        Sort: {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
      </button>
    </div>
  );

  if (!boardData) return <div className="p-8">Loading experiments...</div>;

  // Sorting Logic
  const sortFn = (a: any, b: any) => {
    let dateA = new Date(0).getTime();
    let dateB = new Date(0).getTime();

    if (tab === 'proposals') { dateA = new Date(a.generated_at).getTime(); dateB = new Date(b.generated_at).getTime(); }
    else if (tab === 'active' || tab === 'finished') { dateA = new Date(a.planned_end_date).getTime(); dateB = new Date(b.planned_end_date).getTime(); }
    else if (tab === 'completed') { dateA = new Date(a.end_date).getTime(); dateB = new Date(b.end_date).getTime(); }
    
    return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
  };

  const currentList = (boardData[tab as keyof typeof boardData]?.results || []).sort(sortFn);

  return (
    <div className="p-6 h-full flex flex-col max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="font-serif text-3xl font-bold text-gray-900">Experiments</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search by title..." 
              className="pl-9 pr-4 py-2 border rounded text-sm w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <SortDropdown />
        </div>
      </div>

      <div className="flex border-b border-gray-200 mb-6 bg-white rounded-t-lg shadow-sm">
        <TabButton id="inactive" label="Inactive" count={boardData.inactive.count} />
        <TabButton id="proposals" label="Proposals" count={boardData.proposals.count} />
        <TabButton id="active" label="Active" count={boardData.active.count} />
        <TabButton id="finished" label="Finished" count={boardData.finished.count} />
        <TabButton id="completed" label="Completed" count={boardData.completed.count} />
      </div>

      <div className="flex-1 overflow-y-auto pb-20">
        
        {/* TAB 1: INACTIVE */}
        {tab === 'inactive' && (
          <div className="space-y-4">
            <Card className="flex justify-between items-center sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-600">{selectedInactive.length} listings selected</span>
                <Button 
                  disabled={selectedInactive.length === 0} 
                  loading={isGenerating}
                  onClick={handleGenerate}
                >
                  Generate Proposals
                </Button>
              </div>
              
              {/* Inline Settings */}
              <div className="flex items-center gap-4 text-sm bg-gray-50 px-3 py-2 rounded">
                <span className="font-bold text-gray-700 flex items-center gap-1"><Settings size={14} /> Experiment Settings:</span>
                <label className="flex items-center gap-2">
                  Duration:
                  <input type="number" className="p-1 border rounded w-16 text-center" defaultValue={30} onChange={(e) => setSettings({...settings, run_duration_days: parseInt(e.target.value)})} />
                  Days
                </label>
                <div className="h-4 w-px bg-gray-300 mx-2"></div>
                 <label className="flex items-center gap-2">
                  Model:
                  <select
                    className="p-1 border rounded"
                    value={settings.generation_model}
                    onChange={(e) =>
                      setSettings({ ...settings, generation_model: e.target.value })
                    }
                  >
                    <option value="gpt-5.1">GPT 5.1 (Standard)</option>
                    <option value="gpt-5-mini">GPT 5 mini (Fast)</option>
                  </select>
                </label>
                <div className="h-4 w-px bg-gray-300 mx-2"></div>
                <label className="flex items-center gap-2">
                  Reasoning:
                  <select
                    className="p-1 border rounded"
                    value={settings.reasoning_level}
                    onChange={(e) =>
                      setSettings({ ...settings, reasoning_level: e.target.value })
                    }
                  >
                    <option value="none">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
            </Card>

            <div className="space-y-2">
              {currentList.map((item: ListingPreview) => (
                <Card key={item.listing_id} className="flex items-center gap-4 p-3 hover:bg-gray-50 transition-colors">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 text-blue-600 rounded cursor-pointer"
                    checked={selectedInactive.includes(item.listing_id)}
                    onChange={(e) => {
                      if(e.target.checked) setSelectedInactive([...selectedInactive, item.listing_id]);
                      else setSelectedInactive(selectedInactive.filter(id => id !== item.listing_id));
                    }}
                  />
                  <ListingThumbnail preview={item} onClick={() => navigate('listing', { id: item.listing_id })} />
                  <div className="ml-auto text-sm text-gray-500">Ready for optimization</div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: PROPOSALS */}
        {tab === 'proposals' && (
          <div className="space-y-4">
            {isGenerating && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex items-center gap-3">
                <RefreshCw className="animate-spin text-blue-600" />
                <span className="text-blue-800 font-medium">
                  Generating experiments for {generatingCount} listings...
                </span>
              </div>
            )}

            {currentList.map((p: any) => {
              const isExpanded = expandedProposals.has(p.listing_id);
              const selectedExperimentId = selectedProposalOptions[p.listing_id];

              return (
                <Card key={p.listing_id} className="transition-all hover:shadow-md">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-4 text-left"
                    onClick={() => {
                      const next = new Set(expandedProposals);
                      if (next.has(p.listing_id)) next.delete(p.listing_id);
                      else next.add(p.listing_id);
                      setExpandedProposals(next);
                    }}
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <ListingThumbnail
                        preview={p.preview}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('listing', { id: p.listing_id });
                        }}
                      />
                      <div className="text-sm text-gray-500 space-y-1">
                        <div>
                          Options: {p.option_count}{' '}
                          <span className="ml-2 text-xs text-gray-400">
                            Generated: {p.generated_at?.split('T')[0]}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          Duration: {p.run_duration_days} days · Model: {p.model_used}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center text-xs text-gray-500 gap-1">
                      <span>{isExpanded ? 'Hide options' : 'Show options'}</span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 bg-gray-50 -mx-4 -mb-4 p-4 rounded-b space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(p.options || []).map((opt: ProposalOption, idx: number) => {
                          const description = opt.payload?.new_description || '';
                          const words = description ? description.split(/\s+/) : [];
                          const previewWordCount = 100;
                          const hasMoreDescription = words.length > previewWordCount;
                          const descriptionPreview = hasMoreDescription
                            ? words.slice(0, previewWordCount).join(' ')
                            : description;
                          const isDescriptionExpanded = expandedDescriptions.has(
                            opt.experiment_id,
                          );

                          const originalThumbOrder =
                            (p as any).original_thumbnail_order || [];
                          const thumbnailImages =
                            ((p as any).thumbnail_images as
                              | { listing_image_id: number; url?: string | null }[]
                              | undefined) || [];
                          const originalTitle = decodeHtmlEntities(
                            (p as any).original_title || p.preview?.title || '',
                          );
                          const originalDescription = decodeHtmlEntities(
                            (p as any).original_description || '',
                          );

                          return (
                            <label
                              key={opt.experiment_id}
                              className={`bg-white p-4 rounded border text-sm cursor-pointer flex flex-col transition-colors ${
                                selectedExperimentId === opt.experiment_id
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-dashed border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <div className="flex items-start gap-2 mb-2">
                                <input
                                  type="radio"
                                  name={`proposal-${p.listing_id}`}
                                  className="mt-1"
                                  checked={selectedExperimentId === opt.experiment_id}
                                  onChange={() =>
                                    setSelectedProposalOptions({
                                      ...selectedProposalOptions,
                                      [p.listing_id]: opt.experiment_id,
                                    })
                                  }
                                />
                                <div>
                                  <Badge color="blue">Option {idx + 1}</Badge>
                                  <h5 className="font-bold text-sm mt-2">
                                    {opt.change_type === 'tags' && 'Tag strategy'}
                                    {opt.change_type === 'title' && 'Title rewrite'}
                                    {opt.change_type === 'description' && 'Description refresh'}
                                    {opt.change_type === 'thumbnail' && 'Thumbnail reordering'}
                                    {opt.change_type !== 'tags' &&
                                      opt.change_type !== 'title' &&
                                      opt.change_type !== 'description' &&
                                      opt.change_type !== 'thumbnail' &&
                                      opt.change_type}
                                  </h5>
                                </div>
                              </div>
                              <div className="text-sm text-gray-700 space-y-2 flex-1">
                                <p className="text-gray-600">{opt.hypothesis}</p>

                                {opt.change_type === 'title' && opt.payload?.new_title && (
                                  <div className="border-t pt-2 mt-2 space-y-3">
                                    <div className="space-y-1">
                                      <div className="text-xs font-semibold uppercase text-gray-500 flex items-center gap-2">
                                        Current title
                                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px]">
                                          Original
                                        </span>
                                      </div>
                                      <div className="text-sm text-gray-800 break-words">
                                        {originalTitle}
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-xs font-semibold uppercase text-gray-500 flex items-center gap-2">
                                        Proposed title
                                        <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px]">
                                          New
                                        </span>
                                      </div>
                                      <div className="text-sm font-semibold text-gray-900 break-words">
                                        {opt.payload.new_title}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {opt.change_type === 'description' && description && (
                                  <div className="border-t pt-2 mt-2 space-y-2">
                                    <div className="text-xs font-semibold uppercase text-gray-500 flex items-center gap-2">
                                      New description (preview)
                                      <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px]">
                                        New
                                      </span>
                                    </div>
                                    <div className="whitespace-pre-wrap text-sm text-gray-900">
                                      {isDescriptionExpanded || !hasMoreDescription
                                        ? description
                                        : `${descriptionPreview}…`}
                                    </div>
                                    {hasMoreDescription && (
                                      <button
                                        type="button"
                                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          const next = new Set(expandedDescriptions);
                                          if (next.has(opt.experiment_id)) {
                                            next.delete(opt.experiment_id);
                                          } else {
                                            next.add(opt.experiment_id);
                                          }
                                          setExpandedDescriptions(next);
                                        }}
                                      >
                                        {isDescriptionExpanded ? 'Show less' : 'Show full description'}
                                      </button>
                                    )}
                                    {originalDescription && (
                                      <div className="mt-2">
                                        {showOriginalDescriptions.has(opt.experiment_id) ? (
                                          <div className="mt-2 space-y-1">
                                            <div className="text-xs font-semibold uppercase text-gray-500 flex items-center gap-2">
                                              Original description
                                              <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px]">
                                                Original
                                              </span>
                                            </div>
                                            <div className="whitespace-pre-wrap text-xs text-gray-800">
                                              {originalDescription}
                                            </div>
                                          </div>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="mt-1 text-xs text-red-600 hover:text-red-800 font-medium"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            const next = new Set(showOriginalDescriptions);
                                            if (next.has(opt.experiment_id)) {
                                              next.delete(opt.experiment_id);
                                            } else {
                                              next.add(opt.experiment_id);
                                            }
                                            setShowOriginalDescriptions(next);
                                          }}
                                        >
                                          {showOriginalDescriptions.has(opt.experiment_id)
                                            ? 'Hide original description'
                                            : 'Show original description'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {opt.change_type === 'tags' && (
                                  <div className="border-t pt-2 mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <div className="text-xs font-semibold uppercase text-gray-500">
                                        Tags to add
                                      </div>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {(opt.payload.tags_to_add || []).map((tag: string) => (
                                          <span
                                            key={tag}
                                          className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs"
                                          >
                                            {tag}
                                          </span>
                                        ))}
                                        {(!opt.payload.tags_to_add ||
                                          opt.payload.tags_to_add.length === 0) && (
                                          <span className="text-xs text-gray-400">
                                            No new tags suggested.
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs font-semibold uppercase text-gray-500">
                                        Tags to remove
                                      </div>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {(opt.payload.tags_to_remove || []).map((tag: string) => (
                                          <span
                                            key={tag}
                                          className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs line-through"
                                          >
                                            {tag}
                                          </span>
                                        ))}
                                        {(!opt.payload.tags_to_remove ||
                                          opt.payload.tags_to_remove.length === 0) && (
                                          <span className="text-xs text-gray-400">
                                            No removals suggested.
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {opt.change_type === 'thumbnail' &&
                                  thumbnailImages.length > 0 && (
                                    <div className="border-t pt-2 mt-2 space-y-3">
                                      <div>
                                        <div className="text-xs font-semibold uppercase text-gray-500 flex items-center gap-2">
                                          Current image order
                                          <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px]">
                                            Original
                                          </span>
                                        </div>
                                        <div className="flex gap-2 mt-2">
                                          {(Array.isArray(originalThumbOrder) &&
                                          originalThumbOrder.length
                                            ? originalThumbOrder
                                            : thumbnailImages.map(
                                                (img) => img.listing_image_id,
                                              )
                                          )
                                            .slice(0, 3)
                                            .map((id: number | string) => {
                                              const idStr = String(id);
                                              const img = thumbnailImages.find(
                                                (t) =>
                                                  String(
                                                    t.listing_image_id,
                                                  ) === idStr,
                                              );
                                              if (!img?.url) return null;
                                              return (
                                                <img
                                                  key={idStr}
                                                  src={getImageUrl(img.url)}
                                                  alt=""
                                                  className="w-14 h-14 rounded border object-cover"
                                                />
                                              );
                                            })}
                                        </div>
                                      </div>

                                      <div>
                                        <div className="text-xs font-semibold uppercase text-gray-500 flex items-center gap-2">
                                          Proposed image order
                                          <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px]">
                                            New
                                          </span>
                                        </div>
                                        {Array.isArray(opt.payload?.new_ordering) &&
                                        opt.payload.new_ordering.length > 0 ? (
                                          <div className="flex gap-2 mt-2">
                                            {opt.payload.new_ordering
                                              .slice(0, 3)
                                              .map((id: number | string) => {
                                                const idStr = String(id);
                                                const img = thumbnailImages.find(
                                                  (t) =>
                                                    String(
                                                      t.listing_image_id,
                                                    ) === idStr,
                                                );
                                                if (!img?.url) return null;
                                                return (
                                                  <img
                                                    key={idStr}
                                                    src={getImageUrl(img.url)}
                                                    alt=""
                                                    className="w-14 h-14 rounded border object-cover"
                                                  />
                                                );
                                              })}
                                          </div>
                                        ) : (
                                          <p className="mt-1 text-xs text-gray-400">
                                            No reordering suggested.
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {(!p.options || p.options.length === 0) && (
                        <div className="text-xs text-gray-500">
                          No experiment option details were returned for this proposal yet.
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!selectedExperimentId}
                          onClick={() => {
                            if (selectedExperimentId) {
                              handleApplyProposal(p.listing_id, selectedExperimentId);
                            }
                          }}
                        >
                          Apply Selected Proposal
                        </Button>
                        <div className="flex flex-col md:flex-row items-start md:items-center gap-2 text-xs text-gray-600">
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1">
                              Model
                              <select
                                className="border rounded px-1 py-0.5 bg-white"
                                value={settings.generation_model}
                                onChange={(e) =>
                                  setSettings({
                                    ...settings,
                                    generation_model: e.target.value,
                                  })
                                }
                              >
                                <option value="gpt-5.1">GPT 5.1</option>
                                <option value="gpt-5-mini">GPT 5 mini</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-1">
                              Reasoning
                              <select
                                className="border rounded px-1 py-0.5 bg-white"
                                value={settings.reasoning_level}
                                onChange={(e) =>
                                  setSettings({
                                    ...settings,
                                    reasoning_level: e.target.value,
                                  })
                                }
                              >
                                <option value="none">None</option>
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                            </label>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRegenerate(p.listing_id)}
                          >
                            <RefreshCw className="w-3 h-3 mr-2" /> Regenerate
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            {!isGenerating && currentList.length === 0 && (
              <div className="text-center text-gray-500 py-10">
                No proposals available. Generate some from the Inactive tab.
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACTIVE */}
        {tab === 'active' && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              Active – review ongoing experiments, monitor performance, and decide when
              to keep or revert changes.
            </div>
            {currentList.map((item: ExperimentRecord) => {
              const delta = item.performance?.latest?.normalized_delta || 0;
              const latestViews = item.performance?.latest?.views || 0;
              const confidence = item.performance?.latest?.confidence;
              return (
                <Card
                  key={item.experiment_id}
                  className="flex flex-col md:flex-row md:items-center gap-4 hover:bg-gray-50"
                >
                  <ListingThumbnail
                    preview={item.preview}
                    onClick={() => navigate('listing', { id: item.listing_id })}
                  />

                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="block text-gray-500 text-xs uppercase font-bold">
                        Duration
                      </span>
                      <span>
                        {item.start_date?.split('T')[0]} –{' '}
                        {item.planned_end_date?.split('T')[0]}
                      </span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase font-bold">
                        Views (current period)
                      </span>
                      <span>{latestViews}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase font-bold">
                        Performance vs baseline
                      </span>
                      <span
                        className={`font-bold ${
                          delta > 0
                            ? 'text-green-700'
                            : delta < 0
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}
                        {(delta * 100).toFixed(1)}%
                      </span>
                      {typeof confidence === 'number' && (
                        <div className="text-[11px] text-gray-500">
                          Confidence: {(confidence * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase font-bold">
                        Change type
                      </span>
                      <span className="capitalize">
                        {item.change_types?.[0] || 'Unknown'}
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openResolveModal(item.listing_id, item.experiment_id, 'end_early', {
                        delta,
                        views: latestViews,
                        changeType: item.change_types?.[0] || 'experiment',
                        startDate: item.start_date,
                        plannedEndDate: item.planned_end_date,
                        runDurationDays: item.run_duration_days,
                        model: item.model_used,
                      })
                    }
                  >
                    End Experiment Early
                  </Button>
                </Card>
              );
            })}
          </div>
        )}

        {/* TAB 4: FINISHED */}
        {tab === 'finished' && (
          <div className="space-y-4">
            {currentList.map((item: ExperimentRecord) => {
               const delta = item.performance?.latest?.normalized_delta || 0;
               const confidence = item.performance?.latest?.confidence;
               const isExpanded = expandedItems.has(item.experiment_id);
               const latestViews = item.performance?.latest?.views || 0;
               
               return (
              <Card key={item.experiment_id} className={`border-l-4 ${delta >= 0 ? 'border-l-green-500' : 'border-l-red-500'} transition-all`}>
                <div 
                  className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer"
                  onClick={() => toggleExpand(item.experiment_id)}
                >
                   <ListingThumbnail preview={item.preview} onClick={(e) => { e.stopPropagation(); navigate('listing', { id: item.listing_id }); }} />
                   
                   <div className="flex-1">
                      <div className="flex gap-4 mb-1">
                        <span className={`font-bold ${delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
                           {delta > 0 ? 'Passed' : 'Failed'}: {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
                        </span>
                        <span className="text-sm text-gray-500">Ended: {item.planned_end_date?.split('T')[0]}</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        Click to review and resolve
                        {typeof confidence === 'number' && (
                          <span className="ml-2 text-xs text-gray-500">
                            • Confidence {(confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </p>
                   </div>
                   
                   <Button variant="secondary" size="sm">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                   </Button>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="bg-gray-50 p-4 rounded mb-4 text-sm space-y-2">
                      <p className="font-bold mb-1">Experiment summary</p>
                      <ul className="list-disc pl-5 space-y-1 text-gray-700">
                        <li>
                          Change type:{' '}
                          <span className="capitalize">
                            {item.change_types?.[0] || 'Unknown modification'}
                          </span>
                        </li>
                        <li>
                          Planned run:{' '}
                          {item.start_date?.split('T')[0] || 'Unknown'} –{' '}
                          {item.planned_end_date?.split('T')[0] || 'Unknown'}
                        </li>
                        <li>Duration: {item.run_duration_days} days</li>
                        <li>Model: {item.model_used || 'Default'}</li>
                        <li>
                          Impact: {(delta * 100).toFixed(1)}% normalized view change vs
                          baseline
                        </li>
                        {typeof confidence === 'number' && (
                          <li>Confidence: {(confidence * 100).toFixed(0)}%</li>
                        )}
                        <li>Current period views: {latestViews}</li>
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-3 justify-end">
                       <Button
                         size="md"
                         variant="success"
                         onClick={() => handleResolveAction('keep')}
                       >
                         Keep Change
                       </Button>
                       <Button
                         size="md"
                         variant="danger"
                         onClick={() => handleResolveAction('revert')}
                       >
                         Revert Change
                       </Button>
                       <Button
                         size="md"
                         variant="secondary"
                         onClick={() => handleResolveAction('extend')}
                       >
                         Run Longer
                       </Button>
                    </div>
                  </div>
                )}
              </Card>
            )})}
          </div>
        )}

        {/* TAB 5: COMPLETED */}
        {tab === 'completed' && (
          <div className="space-y-2">
            {currentList.map((item: ExperimentRecord) => {
              const delta = item.performance?.latest?.normalized_delta;
              const confidence = item.performance?.latest?.confidence;
              return (
                <div
                  key={item.experiment_id}
                  className="flex items-center justify-between p-3 bg-white border rounded text-sm hover:bg-gray-50"
                >
                  <ListingThumbnail
                    preview={item.preview}
                    onClick={() => navigate('listing', { id: item.listing_id })}
                  />
                  <div className="flex items-center gap-8 mr-4">
                    <div className="text-right">
                      <div className="text-xs text-gray-500 uppercase">Outcome</div>
                      <Badge color={item.state === 'kept' ? 'green' : 'red'}>
                        {item.state === 'kept' ? 'Kept' : 'Reverted'}
                      </Badge>
                    </div>
                    <div className="text-right w-32">
                      <div className="text-xs text-gray-500 uppercase">
                        Impact vs baseline
                      </div>
                      <div className="text-xs text-gray-900">
                        <span className="font-mono font-bold">
                          {typeof delta === 'number'
                            ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`
                            : 'N/A'}
                        </span>
                        {typeof confidence === 'number' && (
                          <span className="block text-[11px] text-gray-500">
                            Confidence {(confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-gray-500 text-xs">
                      {item.end_date?.split('T')[0]}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RESOLVE / END EARLY MODAL */}
      <Modal 
        isOpen={resolveModal.isOpen} 
        onClose={() => setResolveModal({ isOpen: false, type: null })} 
        title={resolveModal.type === 'end_early' ? "End Experiment Early?" : "Resolve Experiment"}
      >
         <div className="space-y-4">
            {resolveModal.type === 'end_early' && (
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                <div className="flex items-center">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
                  <p className="text-sm text-yellow-700">
                    This experiment hasn't finished its full duration. Ending it now might yield inconclusive data.
                  </p>
                </div>
              </div>
            )}
            
            <div className="space-y-4 py-2">
              <div className="text-center">
                <div className="text-sm text-gray-500 uppercase mb-1">
                  Current performance delta vs baseline
                </div>
                <div
                  className={`text-3xl font-bold ${
                    resolveModal.stats?.delta > 0
                      ? 'text-green-700'
                      : resolveModal.stats?.delta < 0
                        ? 'text-red-600'
                        : 'text-gray-700'
                  }`}
                >
                  {resolveModal.stats?.delta > 0 ? '+' : ''}
                  {(resolveModal.stats?.delta * 100).toFixed(1)}%
                </div>
                {typeof resolveModal.stats?.views === 'number' && (
                  <div className="mt-1 text-xs text-gray-500">
                    Current period views: {resolveModal.stats.views}
                  </div>
                )}
              </div>

              {(resolveModal.stats?.changeType ||
                resolveModal.stats?.runDurationDays ||
                resolveModal.stats?.startDate ||
                resolveModal.stats?.plannedEndDate ||
                resolveModal.stats?.model) && (
                <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-700 space-y-1">
                  <div className="font-semibold text-gray-800">
                    Experiment summary
                  </div>
                  {resolveModal.stats?.changeType && (
                    <div>
                      <span className="font-semibold">Change type: </span>
                      <span className="capitalize">
                        {resolveModal.stats.changeType}
                      </span>
                    </div>
                  )}
                  {(resolveModal.stats?.startDate ||
                    resolveModal.stats?.plannedEndDate) && (
                    <div>
                      <span className="font-semibold">Planned run: </span>
                      <span>
                        {resolveModal.stats.startDate
                          ? resolveModal.stats.startDate.split('T')[0]
                          : 'Unknown'}{' '}
                        –{' '}
                        {resolveModal.stats.plannedEndDate
                          ? resolveModal.stats.plannedEndDate.split('T')[0]
                          : 'Unknown'}
                      </span>
                    </div>
                  )}
                  {resolveModal.stats?.runDurationDays && (
                    <div>
                      <span className="font-semibold">Duration: </span>
                      <span>{resolveModal.stats.runDurationDays} days</span>
                    </div>
                  )}
                  {resolveModal.stats?.model && (
                    <div>
                      <span className="font-semibold">Model: </span>
                      <span>{resolveModal.stats.model}</span>
                    </div>
                  )}
                </div>
              )}

              <p className="text-gray-600 text-sm text-center">
                Based on this performance so far, you can keep the change
                permanently, revert to the original listing, or go back and let
                the experiment continue running.
              </p>
            </div>

            <div className="mt-4 flex flex-col md:flex-row gap-3">
              <Button
                variant="success"
                className="w-full justify-center md:flex-1"
                onClick={() => handleResolveAction('keep')}
              >
                Keep Change (End Experiment)
              </Button>
              <Button
                variant="danger"
                className="w-full justify-center md:flex-1"
                onClick={() => handleResolveAction('revert')}
              >
                Revert Change (End Experiment)
              </Button>
              <Button
                variant="outline"
                className="w-full justify-center md:flex-1"
                onClick={() => handleResolveAction('continue')}
              >
                Go Back / Continue Running
              </Button>
            </div>
         </div>
      </Modal>
    </div>
  );
};

// 3. Listings Catalog Page
const ListingsPage = ({ navigate }: { navigate: any }) => {
  const [listings, setListings] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    api.get('/listings').then(d => setListings(d.results));
  }, []);

  const filteredListings = listings
    .filter((l) => {
      if (!searchTerm) return true;
      return (l.title || '').toLowerCase().includes(searchTerm.toLowerCase());
    })
    .filter((l) => {
      if (stateFilter === 'all') return true;
      return l.state === stateFilter;
    })
    .sort((a, b) => {
      const aDelta = a.lifetime_kept_normalized_delta || 0;
      const bDelta = b.lifetime_kept_normalized_delta || 0;
      return sortOrder === 'desc' ? bDelta - aDelta : aDelta - bDelta;
    });

  const totalExperimentCount = listings.reduce(
    (sum, l) => sum + (l.experiment_count || 0),
    0,
  );

  const avgLifetimeDelta =
    listings.length > 0
      ? listings.reduce(
          (sum, l) => sum + (l.lifetime_kept_normalized_delta || 0),
          0,
        ) / listings.length
      : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-gray-900">
            Listings Catalog
          </h1>
          <p className="text-sm text-gray-500">
            Browse all listings, their experiment history, and performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by title…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[220px]"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="text-sm border border-gray-200 rounded-md px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All states</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <button
            type="button"
            onClick={() =>
              setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
            }
            className="flex items-center text-sm text-gray-600 hover:text-gray-800"
          >
            <Filter className="w-4 h-4 mr-1" />
            Sort by impact: {sortOrder === 'desc' ? 'Best first' : 'Worst first'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="space-y-1">
          <div className="text-xs uppercase text-gray-500 font-semibold">
            Listings tracked
          </div>
          <div className="text-2xl font-bold text-[color:var(--primary)]" style={{ '--primary': COLORS.primary } as any}>
            {listings.length}
          </div>
        </Card>
        <Card className="space-y-1">
          <div className="text-xs uppercase text-gray-500 font-semibold">
            Experiments run
          </div>
          <div className="text-2xl font-bold">{totalExperimentCount}</div>
        </Card>
        <Card className="space-y-1">
          <div className="text-xs uppercase text-gray-500 font-semibold">
            Avg. kept impact
          </div>
          <div className="text-2xl font-bold">
            {avgLifetimeDelta >= 0 ? '+' : ''}
            {(avgLifetimeDelta * 100).toFixed(1)}%
          </div>
        </Card>
      </div>

      <div className="bg-white border border-gray-200 rounded-md shadow-sm">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
          <div className="flex-1">Listing</div>
          <div className="w-28 text-center">State</div>
          <div className="w-32 text-center">Experiments</div>
          <div className="w-32 text-center">Lifetime impact</div>
          <div className="w-24" />
        </div>
        <div className="divide-y divide-gray-100">
          {filteredListings.map((l) => {
            const lifetimeDelta = l.lifetime_kept_normalized_delta || 0;
            const lifetimePct = (lifetimeDelta * 100).toFixed(1) + '%';
            const deltaPositive = lifetimeDelta >= 0;
            return (
              <div
                key={l.listing_id}
                className="flex items-center px-4 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => navigate('listing', { id: l.listing_id })}
              >
                <div className="flex-1 flex items-center gap-4">
                  <ListingThumbnail
                    preview={l.preview}
                    onClick={() => navigate('listing', { id: l.listing_id })}
                  />
                  {l.latest_views && (
                    <div className="hidden md:block text-xs text-gray-500">
                      Last tracked views ({l.latest_views.date}):{' '}
                      {l.latest_views.views ?? '—'}
                    </div>
                  )}
                </div>
                <div className="w-28 text-center">
                  <Badge>{l.state}</Badge>
                </div>
                <div className="w-32 text-center text-xs text-gray-700">
                  <div className="font-semibold">
                    {l.experiment_count || 0} total
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {l.tested_count || 0} completed · {l.untested_count || 0} queued
                  </div>
                </div>
                <div className="w-32 text-center">
                  <span
                    className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-mono ${
                      deltaPositive
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {deltaPositive ? '+' : ''}
                    {lifetimePct}
                  </span>
                </div>
                <div className="w-24 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('listing', { id: l.listing_id });
                    }}
                  >
                    Details <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            );
          })}
          {filteredListings.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-500 text-center">
              No listings match your filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 4. Listing Detail View
const ListingDetail = ({ id, onBack }: { id: number, onBack: () => void }) => {
  const [data, setData] = useState<any>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showFullDescription, setShowFullDescription] = useState(false);

  useEffect(() => {
    setData(null);
    setActiveImageIndex(0);
    setShowFullDescription(false);
    api.get(`/listings/${id}`).then(setData);
  }, [id]);

  if (!data) return <div className="p-10">Loading Listing...</div>;

  const listing = data.listing || {};
  const imagesRecord = data.images || {};
  const fileEntries = Array.isArray(imagesRecord.files) ? imagesRecord.files : [];
  const remoteEntries = Array.isArray(imagesRecord.results) ? imagesRecord.results : [];

  const imageSources: string[] = (fileEntries.length
    ? fileEntries.map((img: any) => img.url || img.path)
    : remoteEntries.map(
        (img: any) => img.url_fullxfull || img.url_570xN || img.url_170x135,
      )
  ).filter(Boolean);

  const mainImageSrc = imageSources[activeImageIndex] || imageSources[0] || null;

  const priceObj = listing.price;
  const price =
    priceObj && typeof priceObj.amount === 'number' && typeof priceObj.divisor === 'number'
      ? (priceObj.amount / priceObj.divisor).toFixed(2)
      : null;

  const description: string = decodeHtmlEntities(listing.description || '');
  const words = description ? description.split(/\s+/) : [];
  const previewWordCount = 100;
  const hasMoreDescription = words.length > previewWordCount;
  const descriptionPreview = hasMoreDescription
    ? words.slice(0, previewWordCount).join(' ')
    : description;

  const testing = data.testing_experiment;
  const untestedMap = data.untested_experiments || {};
  const untestedCount =
    untestedMap && typeof untestedMap === 'object'
      ? Object.keys(untestedMap).length
      : 0;

  const proposal = data.proposal;
  const proposalOptions = proposal?.options || [];

  const formatDelta = (exp: any): string | null => {
    const delta = exp?.performance?.latest?.normalized_delta;
    if (typeof delta !== 'number') return null;
    const pct = (delta * 100).toFixed(1) + '%';
    return (delta >= 0 ? '+' : '') + pct;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <button onClick={onBack} className="mb-4 text-gray-500 hover:text-gray-800 flex items-center gap-1">
        <ArrowRight className="w-4 h-4 rotate-180" /> Back
      </button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="col-span-1 flex flex-col">
          {mainImageSrc ? (
            <>
              <div className="relative mb-3">
                <img
                  src={getImageUrl(mainImageSrc)}
                  alt={listing.title}
                  className="w-full max-h-80 object-cover rounded-md shadow-md"
                />
                {imageSources.length > 1 && (
                  <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                    {activeImageIndex + 1} / {imageSources.length}
                  </div>
                )}
              </div>
              {imageSources.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {imageSources.map((src, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveImageIndex(idx)}
                      className={`border rounded-md overflow-hidden flex-shrink-0 ${
                        idx === activeImageIndex
                          ? 'border-blue-500 ring-2 ring-blue-200'
                          : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <img
                        src={getImageUrl(src)}
                        alt=""
                        className="w-16 h-16 object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
              No images available for this listing.
            </div>
          )}
        </Card>
        <div className="col-span-2 space-y-6">
          <Card className="space-y-3">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <h1 className="font-serif text-2xl font-bold mb-1">
                  {listing.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{listing.state}</Badge>
                  <span className="text-xs text-gray-500">
                    ID: {listing.listing_id}
                  </span>
                </div>
              </div>
              <div className="text-right space-y-1">
                {price && (
                  <div className="text-xl font-bold text-gray-900">
                    ${price}{' '}
                    <span className="text-xs text-gray-500">
                      {listing.price?.currency_code || 'USD'}
                    </span>
                  </div>
                )}
                {listing.url && (
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    View on Etsy
                    <ArrowRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </Card>

           <Card>
             <h3 className="font-bold mb-2">Listing Statistics</h3>
             <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                   <div className="text-2xl font-bold">{listing.views}</div>
                   <div className="text-xs uppercase text-gray-500">Total Views</div>
                </div>
                <div>
                   <div className="text-2xl font-bold">{listing.num_favorers}</div>
                   <div className="text-xs uppercase text-gray-500">Favorites</div>
                </div>
                <div>
                   <div className="text-2xl font-bold">{listing.quantity}</div>
                   <div className="text-xs uppercase text-gray-500">Stock</div>
                </div>
             </div>
           </Card>

           <Card>
              <h3 className="font-serif text-lg font-bold mb-3 border-b pb-2">
                Experiment History
              </h3>
              <div className="space-y-3">
                 {data.tested_experiments.map((exp: any) => {
                   const deltaText = formatDelta(exp);
                   const state = exp.state || '';
                   const badgeColor =
                     state === 'kept' ? 'green' : state === 'reverted' ? 'red' : 'gray';
                   return (
                     <div
                       key={exp.experiment_id}
                       className="flex justify-between items-center text-sm p-3 bg-gray-50 border border-gray-200 rounded"
                     >
                        <div>
                          <div className="font-semibold">
                            {exp.changes?.[0]?.change_type || 'Experiment'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {exp.start_date?.split('T')[0]} to{' '}
                            {exp.end_date?.split('T')[0]}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {deltaText && (
                            <span
                              className={`text-xs font-mono ${
                                deltaText.startsWith('+')
                                  ? 'text-green-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {deltaText}
                            </span>
                          )}
                          <Badge color={badgeColor as any}>{state || 'done'}</Badge>
                        </div>
                     </div>
                   );
                 })}
                 {data.tested_experiments.length === 0 && (
                   <p className="text-gray-500 italic">No past experiments.</p>
                 )}
              </div>
           </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 space-y-4">
          <div>
            <h3 className="font-serif text-lg font-bold mb-2">
              Listing Content
            </h3>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">
              {showFullDescription || !hasMoreDescription
                ? description
                : `${descriptionPreview}…`}
            </div>
            {hasMoreDescription && (
              <button
                type="button"
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                onClick={() => setShowFullDescription((prev) => !prev)}
              >
                {showFullDescription ? 'Show less' : 'Show full description'}
              </button>
            )}
          </div>
          {Array.isArray(listing.tags) && listing.tags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
                Tags
              </h4>
              <div className="flex flex-wrap gap-2">
                {listing.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <h3 className="font-serif text-lg font-bold mb-2">
              Current Experiment
            </h3>
            {testing ? (
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Experiment {testing.experiment_id}
                  </span>
                  <Badge color="blue">Running</Badge>
                </div>
                <div className="text-xs text-gray-600">
                  Change types:{' '}
                  {(testing.change_types ||
                    testing.changes?.map((c: any) => c.change_type) ||
                    []
                  ).join(', ') || 'Experiment'}
                </div>
                <div className="text-xs text-gray-500">
                  Started {testing.start_date?.split('T')[0]}
                  {testing.planned_end_date &&
                    ` · Planned end ${testing.planned_end_date}`}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No experiment currently running on this listing.
              </p>
            )}
            {untestedCount > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                {untestedCount} additional experiment
                {untestedCount > 1 ? 's' : ''} scheduled or waiting to run.
              </p>
            )}
          </Card>

          <Card>
            <h3 className="font-serif text-lg font-bold mb-2">Proposals</h3>
            {proposalOptions.length > 0 ? (
              <div className="space-y-2">
                {proposalOptions.map((opt: any, idx: number) => (
                  <div
                    key={opt.experiment_id || idx}
                    className="p-2 rounded border border-dashed border-blue-200 bg-blue-50/40 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold capitalize text-gray-800">
                        {opt.change_type || 'Experiment option'}
                      </span>
                      <span className="text-[10px] uppercase text-gray-500">
                        Option {idx + 1}
                      </span>
                    </div>
                    {opt.hypothesis && (
                      <p className="text-gray-700">
                        {opt.hypothesis}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No open proposals for this listing.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

// 5. Reports
const ReportsPage = ({ initialReportId }: { initialReportId?: string }) => {
  const [reports, setReports] = useState<Report[]>([]);
  const [activeInsights, setActiveInsights] = useState<Insight[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportModel, setReportModel] = useState('gpt-5.1');
  const [reportReasoning, setReportReasoning] = useState<'none' | 'low' | 'medium' | 'high'>('low');
  const [pastPage, setPastPage] = useState(1);

  const refresh = () => {
    api.get('/reports').then((d) => {
      setReports(d.results);
      if (!selectedReportId && d.results.length > 0) {
        setSelectedReportId(d.results[d.results.length - 1].report_id);
      }
    });
    api.get('/insights/active').then((d) => setActiveInsights(d.results));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialReportId) {
      setSelectedReportId(initialReportId);
    }
  }, [initialReportId]);

  useEffect(() => {
    setPastPage(1);
  }, [selectedReportId, reports.length]);

  const handleCreateReport = async () => {
    try {
      setGenerating(true);
      const created = await api.post('/reports', {
        days_back: 30,
        model: reportModel,
        reasoning_level: reportReasoning,
      });
      if (created?.report_id) {
        setSelectedReportId(created.report_id);
      }
      refresh();
    } catch (e) {
      alert('Error generating report');
    } finally {
      setGenerating(false);
    }
  };

  const handleActivateInsight = async (reportId: string, insightId: string) => {
    try {
      await api.post(`/reports/${reportId}/activate_insights`, {
        insight_ids: [insightId],
      });
      refresh();
    } catch (e) {
      alert('Failed to activate');
    }
  };

  const mostRecentReport = reports.length > 0 ? reports[reports.length - 1] : null;
  const selectedReport =
    reports.find((r) => r.report_id === selectedReportId) || mostRecentReport;

  const PAST_PAGE_SIZE = 5;
  const sortedReports = [...reports].sort((a: any, b: any) => {
    const aEnd = (a.window && a.window.end) || a.window_end || '';
    const bEnd = (b.window && b.window.end) || b.window_end || '';
    return bEnd.localeCompare(aEnd);
  });
  const currentReportId = (selectedReport as any)?.report_id;
  const pastReports = sortedReports.filter(
    (r) => !currentReportId || r.report_id !== currentReportId,
  );
  const totalPastPages = Math.max(
    1,
    Math.ceil((pastReports.length || 1) / PAST_PAGE_SIZE),
  );
  const safePastPage = Math.min(pastPage, totalPastPages);
  const pastReportsPage = pastReports.slice(
    (safePastPage - 1) * PAST_PAGE_SIZE,
    safePastPage * PAST_PAGE_SIZE,
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-gray-900">
            Experiment Reports
          </h1>
          <p className="text-sm text-gray-500">
            Review performance summaries and activate insights directly from each
            report.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3 text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded">
            <span className="font-semibold">LLM Settings:</span>
            <label className="flex items-center gap-1">
              Model
              <select
                className="p-1 border rounded bg-white"
                value={reportModel}
                onChange={(e) => setReportModel(e.target.value)}
              >
                <option value="gpt-5.1">GPT 5.1 (Standard)</option>
                <option value="gpt-5-mini">GPT 5 mini (Fast)</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              Reasoning
              <select
                className="p-1 border rounded bg-white"
                value={reportReasoning}
                onChange={(e) =>
                  setReportReasoning(e.target.value as any)
                }
              >
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <Button onClick={handleCreateReport} loading={generating}>
            Generate New Report (30 Days)
          </Button>
        </div>
      </div>

      {selectedReport ? (() => {
        const currentWindow = (selectedReport as any)?.window || {};
        const windowStart =
          (currentWindow.start as string | undefined) ||
          (selectedReport as any).window_start;
        const windowEnd =
          (currentWindow.end as string | undefined) ||
          (selectedReport as any).window_end;
        const markdown: string = decodeHtmlEntities(
          (selectedReport as any)?.llm_report?.report_markdown ||
            (selectedReport as any)?.raw_llm_response?.report?.report_markdown ||
            (selectedReport as any)?.report_markdown ||
            '',
        );
        const reportInsights = ((selectedReport as any).insights || []) as any[];
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                    Period
                  </div>
                  <div className="text-sm text-gray-800">
                    {windowStart} — {windowEnd}
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                {markdown ? (
                  <ReactMarkdown
                    className="text-sm text-gray-800 leading-relaxed"
                    components={{
                      p: ({ node, ...props }: any) => (
                        <p
                          className="mb-3 whitespace-pre-wrap"
                          {...props}
                        />
                      ),
                      h1: ({ node, ...props }: any) => (
                        <h1
                          className="mt-4 mb-2 text-lg font-semibold text-gray-900"
                          {...props}
                        />
                      ),
                      h2: ({ node, ...props }: any) => (
                        <h2
                          className="mt-4 mb-2 text-base font-semibold text-gray-900"
                          {...props}
                        />
                      ),
                      h3: ({ node, ...props }: any) => (
                        <h3
                          className="mt-3 mb-2 text-sm font-semibold text-gray-900"
                          {...props}
                        />
                      ),
                      ul: ({ node, ...props }: any) => (
                        <ul
                          className="list-disc pl-5 mb-3 space-y-1"
                          {...props}
                        />
                      ),
                      ol: ({ node, ...props }: any) => (
                        <ol
                          className="list-decimal pl-5 mb-3 space-y-1"
                          {...props}
                        />
                      ),
                      li: ({ node, ...props }: any) => (
                        <li className="mb-1" {...props} />
                      ),
                    }}
                  >
                    {markdown}
                  </ReactMarkdown>
                ) : (
                  <p className="text-sm text-gray-500">
                    This report does not contain markdown content.
                  </p>
                )}
              </div>
            </Card>

            <Card className="space-y-3">
              <h2 className="font-serif text-lg font-bold text-gray-900 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                Insights in this report
              </h2>
              <p className="text-xs text-gray-500">
                Check to activate an insight. Active insights also appear on the
                Insights page.
              </p>
              <div className="space-y-2 overflow-y-auto pr-1 max-h-96 md:max-h-none">
                {reportInsights.map((insight: any) => {
                  const isActive = activeInsights.some(
                    (ai) => ai.insight_id === insight.insight_id,
                  );
                  return (
                    <label
                      key={insight.insight_id}
                      className="flex items-start gap-3 text-xs p-2 rounded hover:bg-gray-50 transition-colors border border-gray-100"
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        disabled={isActive}
                        onChange={() =>
                          !isActive &&
                          handleActivateInsight(
                            (selectedReport as any).report_id,
                            insight.insight_id,
                          )
                        }
                        className="mt-0.5 w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {insight.text}
                        </div>
                        {insight.reasoning && (
                          <div className="text-[11px] text-gray-600 mt-1">
                            {insight.reasoning}
                          </div>
                        )}
                      </div>
                      {isActive && (
                        <span className="text-green-600 text-[10px] font-bold px-2 py-1 bg-green-50 rounded">
                          Active
                        </span>
                      )}
                    </label>
                  );
                })}
                {reportInsights.length === 0 && (
                  <p className="text-xs text-gray-500">
                    This report does not contain any structured insights.
                  </p>
                )}
              </div>
            </Card>
          </div>
        );
      })() : (
        <div className="text-center py-10 bg-gray-50 rounded border border-dashed">
          <p className="text-gray-500">No reports generated yet.</p>
        </div>
      )}

      {pastReports.length > 0 && (
        <section className="border-t pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg font-bold text-gray-900">
              Past reports
            </h3>
            {pastReports.length > PAST_PAGE_SIZE && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>
                  Page {safePastPage} of {totalPastPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePastPage === 1}
                  onClick={() => setPastPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePastPage === totalPastPages}
                  onClick={() =>
                    setPastPage((p) => Math.min(totalPastPages, p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {pastReportsPage.map((r) => (
              <button
                key={r.report_id}
                type="button"
                onClick={() => setSelectedReportId(r.report_id)}
                className={`w-full text-left p-3 rounded border text-sm flex justify-between items-center transition-colors ${
                  currentReportId === r.report_id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>
                  {(r as any).window?.start || (r as any).window_start} —{' '}
                  {(r as any).window?.end || (r as any).window_end}
                </span>
                <span className="text-xs text-gray-400">
                  Generated {r.generated_at?.split('T')[0]}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

// 6. Insights
const InsightsPage = () => {
  const [activeInsights, setActiveInsights] = useState<Insight[]>([]);
  const [availableInsights, setAvailableInsights] = useState<
    { report_id: string; window_end?: string; insight: any }[]
  >([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'alpha'>('recent');
   const [activePage, setActivePage] = useState(1);
   const [availablePage, setAvailablePage] = useState(1);
   const PAGE_SIZE = 12;

  const refresh = () => {
    api.get('/insights/active').then((d) => setActiveInsights(d.results));
    api.get('/reports').then((d) => {
      const reports: any[] = d.results || [];
      const collected: { report_id: string; window_end?: string; insight: any }[] =
        [];
      reports.forEach((r) => {
        const windowEnd = (r.window && r.window.end) || r.window_end;
        (r.insights || []).forEach((ins: any) => {
          collected.push({ report_id: r.report_id, window_end: windowEnd, insight: ins });
        });
      });
      setAvailableInsights(collected);
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleDeactivateInsight = async (insightId: string) => {
    try {
      await api.delete(`/insights/active/${insightId}`);
      refresh();
    } catch (e) {
      alert('Failed to deactivate');
    }
  };

  const activeIds = new Set(
    activeInsights.map((ins) => String(ins.insight_id)),
  );

  useEffect(() => {
    setActivePage(1);
  }, [activeInsights.length]);

  const filteredAvailable = availableInsights
    .filter(({ insight }) => !activeIds.has(String(insight.insight_id)))
    .filter(({ insight }) => {
      if (!searchTerm) return true;
      const haystack =
        ((insight.text || '') + ' ' + (insight.reasoning || '')).toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === 'alpha') {
        return (a.insight.text || '').localeCompare(b.insight.text || '');
      }
      const aDate = a.window_end || '';
      const bDate = b.window_end || '';
      return bDate.localeCompare(aDate);
    });

  useEffect(() => {
    setAvailablePage(1);
  }, [searchTerm, sortBy, availableInsights.length]);

  const pagedActive = activeInsights.slice(
    (activePage - 1) * PAGE_SIZE,
    activePage * PAGE_SIZE,
  );
  const activeTotalPages = Math.max(
    1,
    Math.ceil(activeInsights.length / PAGE_SIZE),
  );

  const pagedAvailable = filteredAvailable.slice(
    (availablePage - 1) * PAGE_SIZE,
    availablePage * PAGE_SIZE,
  );
  const availableTotalPages = Math.max(
    1,
    Math.ceil(filteredAvailable.length / PAGE_SIZE),
  );

  const handleActivateInsight = async (
    reportId: string,
    insightId: string,
  ) => {
    try {
      await api.post(`/reports/${reportId}/activate_insights`, {
        insight_ids: [insightId],
      });
      refresh();
    } catch (e) {
      alert('Failed to activate insight');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-gray-900">
            Active Insights
          </h1>
          <p className="text-sm text-gray-500">
            Manage which insights are currently driving experiment generation.
          </p>
        </div>
        <Badge color="yellow">Active: {activeInsights.length}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pagedActive.map((insight, idx) => {
          const meta = availableInsights.find(
            (entry) =>
              String(entry.insight.insight_id) ===
              String(insight.insight_id),
          );
          const windowEnd = meta?.window_end;
          const reportId = meta?.report_id || insight.report_id;
          return (
            <Card
              key={insight.insight_id}
              className="space-y-2 border border-yellow-200 bg-yellow-50"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold">
                    <Lightbulb className="w-3 h-3" />
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-yellow-800 font-semibold">
                    Insight
                  </span>
                </div>
                <button
                  onClick={() => handleDeactivateInsight(insight.insight_id)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <XCircle size={18} />
                </button>
              </div>
              <div>
                <p className="font-medium text-gray-900">{insight.text}</p>
                {insight.reasoning && (
                  <p className="text-sm text-gray-700 mt-2">
                    {insight.reasoning}
                  </p>
                )}
              </div>
              {(windowEnd || reportId) && (
                <div className="flex items-center justify-between pt-1 border-t border-yellow-200 mt-2 text-xs text-gray-600">
                  <span>
                    {windowEnd
                      ? `From report ending ${windowEnd}`
                      : 'Source report'}
                  </span>
                  {reportId && (
                    <a
                      href={`/reports?report_id=${encodeURIComponent(
                        reportId,
                      )}`}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                    >
                      View report
                      <ArrowRight className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {activeInsights.length === 0 && (
          <p className="text-gray-500 italic">
            No active insights at the moment. Activate them from the Reports
            page.
          </p>
        )}
      </div>

      {activeInsights.length > PAGE_SIZE && (
        <div className="flex justify-end items-center gap-3 text-xs text-gray-600">
          <span>
            Page {activePage} of {activeTotalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={activePage === 1}
            onClick={() => setActivePage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={activePage === activeTotalPages}
            onClick={() =>
              setActivePage((p) => Math.min(activeTotalPages, p + 1))
            }
          >
            Next
          </Button>
        </div>
      )}

      <section className="border-t pt-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-bold text-gray-900">
              Available Insights
            </h2>
            <p className="text-sm text-gray-500">
              Browse inactive insights from past reports and activate the ones
              you want to drive new experiments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search insights…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[220px]"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-md px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="recent">Newest reports first</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pagedAvailable.map(({ report_id, window_end, insight }) => (
            <Card
              key={insight.insight_id}
              className="space-y-2 border border-blue-200 bg-blue-50"
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold">
                    <Lightbulb className="w-3 h-3" />
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-blue-800 font-semibold">
                    Available insight
                  </span>
                </div>
                <p className="font-medium text-gray-900">{insight.text}</p>
                {insight.reasoning && (
                  <p className="text-sm text-gray-700 mt-2">
                    {insight.reasoning}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-blue-200 text-xs text-gray-600">
                <span>
                  {window_end
                    ? `From report ending ${window_end}`
                    : 'Source report'}
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={`/reports?report_id=${encodeURIComponent(
                      report_id,
                    )}`}
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                  >
                    View report
                    <ArrowRight className="w-3 h-3" />
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleActivateInsight(report_id, insight.insight_id)
                    }
                  >
                    Activate
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {filteredAvailable.length === 0 && (
            <p className="text-sm text-gray-500">
              No additional insights available to activate.
            </p>
          )}
        </div>

        {filteredAvailable.length > PAGE_SIZE && (
          <div className="flex justify-end items-center gap-3 text-xs text-gray-600 mt-2">
            <span>
              Page {availablePage} of {availableTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={availablePage === 1}
              onClick={() => setAvailablePage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={availablePage === availableTotalPages}
              onClick={() =>
                setAvailablePage((p) => Math.min(availableTotalPages, p + 1))
              }
            >
              Next
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

// --- Main App Shell ---

export default function App() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const [syncing, setSyncing] = useState(false);

  const searchParams = new URLSearchParams(location.search);
  const path = location.pathname;

  let view: 'overview' | 'experiments' | 'listings' | 'reports' | 'insights' | 'listing_detail';
  const params: any = {};

  if (path.startsWith('/experiments')) {
    view = 'experiments';
    params.tab = searchParams.get('tab') || 'active';
  } else if (path === '/listings') {
    view = 'listings';
  } else if (path.startsWith('/listings/')) {
    view = 'listing_detail';
    const parts = path.split('/');
    const idStr = parts[2];
    const id = Number(idStr);
    if (!Number.isNaN(id)) {
      params.id = id;
    }
  } else if (path === '/reports') {
    view = 'reports';
    const reportId = searchParams.get('report_id');
    if (reportId) {
      params.reportId = reportId;
    }
  } else if (path === '/insights') {
    view = 'insights';
  } else {
    view = 'overview';
  }

  const navigate = (newView: string, newParams: any = {}) => {
    switch (newView) {
      case 'overview':
        routerNavigate('/');
        break;
      case 'experiments': {
        const tab = newParams.tab || params.tab || 'active';
        routerNavigate(`/experiments?tab=${encodeURIComponent(tab)}`);
        break;
      }
      case 'listings':
        routerNavigate('/listings');
        break;
      case 'listing':
      case 'listing_detail': {
        const id = newParams.id ?? newParams.listing_id;
        if (id != null) {
          routerNavigate(`/listings/${id}`);
        }
        break;
      }
      case 'reports':
        if (newParams.reportId) {
          routerNavigate(`/reports?report_id=${encodeURIComponent(newParams.reportId)}`);
        } else {
          routerNavigate('/reports');
        }
        break;
      case 'insights':
        routerNavigate('/insights');
        break;
      default:
        routerNavigate('/');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/sync');
      const current = `${location.pathname}${location.search}`;
      routerNavigate('/');
      setTimeout(() => routerNavigate(current), 50);
    } catch {
      alert('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const NavItem = ({ id, label, icon: Icon }: any) => {
    const isActive =
      view === id || (id === 'experiments' && view === 'experiments');
    return (
      <button
        onClick={() => navigate(id)}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-md
          ${
            isActive
              ? 'bg-[#0a8bdf] text-white'
              : 'text-gray-300 hover:bg-[#0a8bdf] hover:text-white'
          }
        `}
      >
        <Icon size={16} />
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#f4f7fb] font-sans text-[#1f2a37]">
      <header className="bg-[#1f2a37] text-white shadow-md flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="font-serif text-xl font-bold tracking-tight flex items-center gap-2">
              <FlaskConical className="text-[#0573bb]" />
              Auto Etsy SEO
            </h1>
            <nav className="hidden md:flex items-center gap-2">
              <NavItem id="overview" label="Overview" icon={LayoutDashboard} />
              <NavItem id="experiments" label="Experiments" icon={FlaskConical} />
              <NavItem id="listings" label="Listings" icon={Tag} />
              <NavItem id="reports" label="Reports" icon={FileText} />
              <NavItem id="insights" label="Insights" icon={Lightbulb} />
            </nav>
          </div>

          <Button
            className="bg-[#0573bb] hover:bg-[#0a8bdf] text-white border-none shadow-none text-sm px-4 py-2"
            onClick={handleSync}
            loading={syncing}
          >
            Sync with Etsy
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto relative">
        {view === 'overview' && <Overview navigate={navigate} />}
        {view === 'experiments' && (
          <ExperimentsPage initialTab={params.tab || 'active'} navigate={navigate} />
        )}
        {view === 'listings' && <ListingsPage navigate={navigate} />}
        {view === 'reports' && <ReportsPage initialReportId={params.reportId} />}
        {view === 'insights' && <InsightsPage />}
        {view === 'listing_detail' && (
          <ListingDetail
            id={params.id}
            onBack={() => {
              // Go back to wherever the user was before hitting the detail view.
              if (window.history.length > 1) {
                routerNavigate(-1);
              } else {
                routerNavigate('/listings');
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
