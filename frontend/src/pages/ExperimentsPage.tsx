import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Filter, Search, Settings } from 'lucide-react';
import { Button, Card, Badge, Modal } from '../components/ui';
import { ListingThumbnail } from '../components/ListingThumbnail';
import type { ExperimentRecord } from '../types';
import { api } from '../api';
import { COLORS } from '../config';

export const ExperimentsPage = ({
  initialTab = 'active',
  navigate,
}: {
  initialTab?: string;
  navigate: any;
}) => {
  const [tab, setTab] = useState(initialTab);
  const [boardData, setBoardData] = useState<any>(null);
  const [, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const [selectedInactive, setSelectedInactive] = useState<number[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingCount, setGeneratingCount] = useState(0);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState({
    run_duration_days: 30,
    generation_model: 'gpt-4',
  });

  const [resolveModal, setResolveModal] = useState<{
    isOpen: boolean;
    listingId?: number;
    experimentId?: string;
    type: 'end_early' | 'resolve' | null;
    stats?: any;
  }>({ isOpen: false, type: null });

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
    const next = new Set(expandedItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedItems(next);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratingCount(selectedInactive.length);
    try {
      await api.post('/experiments/proposals', { listing_ids: selectedInactive });
      setSelectedInactive([]);
      refresh();
      setTab('proposals');
    } catch {
      alert('Failed to generate proposals');
    } finally {
      setIsGenerating(false);
      setGeneratingCount(0);
    }
  };

  const handleApplyProposal = async (listingId: number, experimentId: string) => {
    try {
      if (boardData) {
        setBoardData({
          ...boardData,
          proposals: {
            ...boardData.proposals,
            results: boardData.proposals.results.filter(
              (r: any) => r.listing_id !== listingId,
            ),
          },
        });
      }
      await api.post(`/experiments/proposals/${listingId}/select`, {
        experiment_id: experimentId,
      });
      refresh();
    } catch {
      alert('Error starting experiment');
      refresh();
    }
  };

  const handleRegenerate = async (listingId: number) => {
    try {
      await api.post(`/experiments/proposals/${listingId}/regenerate`);
      refresh();
    } catch {
      alert('Failed');
    }
  };

  const handleResolveAction = async (
    action: 'keep' | 'revert' | 'extend' | 'continue',
  ) => {
    const { listingId, experimentId } = resolveModal;
    if (!listingId || !experimentId) return;

    try {
      if (action === 'continue') {
        setResolveModal({ isOpen: false, type: null });
        return;
      }

      if (action === 'extend') {
        const days = prompt('How many days to extend?', '7');
        if (!days) return;
        await api.post(`/experiments/${listingId}/${experimentId}/extend`, {
          additional_days: parseInt(days, 10),
        });
      } else {
        await api.post(`/experiments/${listingId}/${experimentId}/${action}`);
      }

      setResolveModal({ isOpen: false, type: null });
      refresh();
    } catch {
      alert('Failed to resolve');
    }
  };

  const openResolveModal = (
    listingId: number,
    experimentId: string,
    type: 'end_early' | 'resolve',
    stats: any,
  ) => {
    setResolveModal({ isOpen: true, listingId, experimentId, type, stats });
  };

  const TabButton = ({ id, label, count }: any) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors flex-1 justify-center
        ${
          tab === id
            ? `border-[${COLORS.primary}] text-[${COLORS.primary}]`
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }
      `}
    >
      {label}
      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
        {count || 0}
      </span>
    </button>
  );

  const SortDropdown = () => (
    <div className="relative inline-block text-left ml-4">
      <button
        onClick={() =>
          setSortOrder(current => (current === 'desc' ? 'asc' : 'desc'))
        }
        className="flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <Filter className="w-4 h-4 mr-1" />
        Sort: {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
      </button>
    </div>
  );

  if (!boardData) {
    return <div className="p-8">Loading experiments...</div>;
  }

  const sortFn = (a: any, b: any) => {
    let dateA = new Date(0).getTime();
    let dateB = new Date(0).getTime();

    if (tab === 'proposals') {
      dateA = new Date(a.generated_at).getTime();
      dateB = new Date(b.generated_at).getTime();
    } else if (tab === 'active' || tab === 'finished') {
      dateA = new Date(a.planned_end_date).getTime();
      dateB = new Date(b.planned_end_date).getTime();
    } else if (tab === 'completed') {
      dateA = new Date(a.end_date).getTime();
      dateB = new Date(b.end_date).getTime();
    }

    return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
  };

  const currentList = (boardData[tab as keyof typeof boardData]?.results || []).sort(
    sortFn,
  );

  return (
    <div className="p-6 h-full flex flex-col max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="font-serif text-3xl font-bold text-gray-900">
          Experiments
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by title..."
              className="pl-9 pr-4 py-2 border rounded text-sm w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
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
        {tab === 'inactive' && (
          <div className="space-y-4">
            <Card className="flex justify-between items-center sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-600">
                  {selectedInactive.length} listings selected
                </span>
                <Button
                  disabled={selectedInactive.length === 0}
                  loading={isGenerating}
                  onClick={handleGenerate}
                >
                  Generate Proposals
                </Button>
              </div>

              <div className="flex items-center gap-4 text-sm bg-gray-50 px-3 py-2 rounded">
                <span className="font-bold text-gray-700 flex items-center gap-1">
                  <Settings size={14} /> Experiment Settings:
                </span>
                <label className="flex items-center gap-2">
                  Duration:
                  <input
                    type="number"
                    className="p-1 border rounded w-16 text-center"
                    defaultValue={30}
                    onChange={e =>
                      setSettings({
                        ...settings,
                        run_duration_days: parseInt(e.target.value, 10),
                      })
                    }
                  />
                  Days
                </label>
                <div className="h-4 w-px bg-gray-300 mx-2" />
                <label className="flex items-center gap-2">
                  Model:
                  <select
                    className="p-1 border rounded"
                    onChange={e =>
                      setSettings({
                        ...settings,
                        generation_model: e.target.value,
                      })
                    }
                  >
                    <option value="gpt-4">GPT-4 (Standard)</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 (Fast)</option>
                  </select>
                </label>
              </div>
            </Card>

            <div className="space-y-2">
              {currentList.map((item: any) => (
                <Card
                  key={item.listing_id}
                  className="flex items-center gap-4 p-3 hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="w-5 h-5 text-blue-600 rounded cursor-pointer"
                    checked={selectedInactive.includes(item.listing_id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedInactive([...selectedInactive, item.listing_id]);
                      } else {
                        setSelectedInactive(
                          selectedInactive.filter(id => id !== item.listing_id),
                        );
                      }
                    }}
                  />
                  <ListingThumbnail
                    preview={item}
                    onClick={() => navigate('listing', { id: item.listing_id })}
                  />
                  <div className="ml-auto text-sm text-gray-500">
                    Ready for optimization
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {tab === 'proposals' && (
          <div className="space-y-4">
            {isGenerating && (
              <Card className="bg-blue-50 border-blue-200">
                <div className="flex items-center gap-3 text-sm text-blue-800">
                  <span className="font-semibold">
                    Generating {generatingCount} new proposals...
                  </span>
                  <span className="text-xs text-blue-600">
                    This may take up to a minute depending on load.
                  </span>
                </div>
              </Card>
            )}

            {currentList.map((item: any) => (
              <Card
                key={item.listing_id}
                className="flex flex-col md:flex-row gap-4 items-start md:items-center"
              >
                <ListingThumbnail
                  preview={item.preview}
                  onClick={() => navigate('listing', { id: item.listing_id })}
                />
                <div className="flex-1 space-y-2 text-sm">
                  <div className="flex gap-2 items-center flex-wrap">
                    <Badge color="blue">New Proposal</Badge>
                    <span className="text-gray-500">
                      Options: {item.option_count}
                    </span>
                    <span className="text-gray-400 text-xs">
                      Generated: {item.generated_at?.split('T')[0]}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {item.options.map((opt: any) => (
                      <div
                        key={opt.experiment_id}
                        className="p-3 rounded border border-dashed border-gray-200 bg-gray-50"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-semibold uppercase text-gray-600">
                            {opt.change_type}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {opt.hypothesis.length > 40
                              ? `${opt.hypothesis.slice(0, 40)}...`
                              : opt.hypothesis}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="primary"
                          className="mt-2 w-full justify-center"
                          onClick={() =>
                            handleApplyProposal(item.listing_id, opt.experiment_id)
                          }
                        >
                          Start Experiment
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500">
                    Duration: {item.run_duration_days} days · Model:{' '}
                    {item.model_used}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegenerate(item.listing_id)}
                  >
                    Regenerate
                  </Button>
                </div>
              </Card>
            ))}

            {currentList.length === 0 && !isGenerating && (
              <div className="text-center text-gray-500 text-sm py-10">
                No proposals available. Generate some from the Inactive tab.
              </div>
            )}
          </div>
        )}

        {tab === 'active' && (
          <div className="space-y-3">
            {currentList.map((item: ExperimentRecord) => {
              const delta = item.performance?.latest?.normalized_delta || 0;
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
                        {item.start_date?.split('T')[0]} -{' '}
                        {item.planned_end_date?.split('T')[0]}
                      </span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase font-bold">
                        Views
                      </span>
                      <span>{item.performance?.latest?.views || 0}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase font-bold">
                        Performance
                      </span>
                      <span
                        className={`font-bold ${
                          delta > 0
                            ? 'text-green-600'
                            : delta < 0
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}
                        {(delta * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openResolveModal(item.listing_id, item.experiment_id, 'end_early', {
                        delta,
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

        {tab === 'finished' && (
          <div className="space-y-4">
            {currentList.map((item: ExperimentRecord) => {
              const delta = item.performance?.latest?.normalized_delta || 0;
              const isExpanded = expandedItems.has(item.experiment_id);

              return (
                <Card
                  key={item.experiment_id}
                  className={`border-l-4 ${
                    delta >= 0 ? 'border-l-green-500' : 'border-l-red-500'
                  } transition-all`}
                >
                  <div
                    className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer"
                    onClick={() => toggleExpand(item.experiment_id)}
                  >
                    <ListingThumbnail
                      preview={item.preview}
                      onClick={e => {
                        e.stopPropagation();
                        navigate('listing', { id: item.listing_id });
                      }}
                    />

                    <div className="flex-1">
                      <div className="flex gap-4 mb-1">
                        <span
                          className={`font-bold ${
                            delta > 0 ? 'text-green-700' : 'text-red-700'
                          }`}
                        >
                          {delta > 0 ? 'Passed' : 'Failed'}:{' '}
                          {delta > 0 ? '+' : ''}
                          {(delta * 100).toFixed(1)}%
                        </span>
                        <span className="text-sm text-gray-500">
                          Ended: {item.planned_end_date?.split('T')[0]}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        Click to review and resolve
                      </p>
                    </div>

                    <Button variant="secondary" size="sm">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="bg-gray-50 p-4 rounded mb-4 text-sm">
                        <p className="font-bold mb-1">Experiment Details:</p>
                        <ul className="list-disc pl-5 space-y-1 text-gray-700">
                          <li>
                            Change:{' '}
                            {item.change_types?.[0] || 'Unknown Modification'}
                          </li>
                          <li>Ran for: {item.run_duration_days} days</li>
                          <li>
                            Impact:{' '}
                            {(delta * 100).toFixed(1)}% normalized view change vs
                            baseline.
                          </li>
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
              );
            })}
          </div>
        )}

        {tab === 'completed' && (
          <div className="space-y-2">
            {currentList.map((item: ExperimentRecord) => (
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
                    <Badge color={item.state === 'kept' ? 'green' : 'gray'}>
                      {item.state}
                    </Badge>
                  </div>
                  <div className="text-right w-24">
                    <div className="text-xs text-gray-500 uppercase">Impact</div>
                    <span className="font-mono font-bold">
                      {item.performance?.latest?.normalized_delta
                        ? `${(item.performance.latest.normalized_delta * 100).toFixed(1)}%`
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="text-right text-gray-500 text-xs">
                    {item.end_date?.split('T')[0]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={resolveModal.isOpen}
        onClose={() => setResolveModal({ isOpen: false, type: null })}
        title={
          resolveModal.type === 'end_early'
            ? 'End Experiment Early?'
            : 'Resolve Experiment'
        }
      >
        <div className="space-y-4">
          {resolveModal.type === 'end_early' && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
              <div className="flex items-center">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
                <p className="text-sm text-yellow-700">
                  This experiment hasn't finished its full duration. Ending it now
                  might yield inconclusive data.
                </p>
              </div>
            </div>
          )}

          <div className="text-center py-4">
            <div className="text-sm text-gray-500 uppercase mb-1">
              Current Performance Delta
            </div>
            <div
              className={`text-4xl font-bold ${
                resolveModal.stats?.delta > 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {resolveModal.stats?.delta > 0 ? '+' : ''}
              {(resolveModal.stats?.delta * 100).toFixed(1)}%
            </div>
          </div>

          <p className="text-gray-600 text-sm text-center mb-6">
            You can choose to keep the changes permanently, revert to the original
            listing, or go back and let it run.
          </p>

          <div className="grid grid-cols-1 gap-3">
            <Button
              variant="success"
              className="w-full justify-center"
              onClick={() => handleResolveAction('keep')}
            >
              Keep Change (End Experiment)
            </Button>
            <Button
              variant="danger"
              className="w-full justify-center"
              onClick={() => handleResolveAction('revert')}
            >
              Revert Change (End Experiment)
            </Button>
            <Button
              variant="outline"
              className="w-full justify-center"
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
