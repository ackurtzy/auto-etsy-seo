import React, { useEffect, useState } from 'react';
import type { OverviewStats } from '../types';
import { COLORS } from '../config';
import { api } from '../api';
import { Card } from '../components/ui';
import { ListingThumbnail } from '../components/ListingThumbnail';

export const OverviewPage = ({
  navigate,
}: {
  navigate: (page: string, params?: any) => void;
}) => {
  const [data, setData] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/overview')
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="p-8 text-center text-gray-500">Loading Overview...</div>
    );
  }

  const StatCard = ({ title, count, onClick, subtext, metric }: any) => (
    <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
      <div onClick={onClick} className="h-full flex flex-col">
        <h3 className="font-serif text-lg font-bold text-gray-700 mb-2">
          {title}
        </h3>
        <div
          className="text-4xl font-bold text-[color:var(--primary)] mb-2"
          style={{ '--primary': COLORS.primary } as React.CSSProperties}
        >
          {count}
        </div>
        {subtext && (
          <p className="text-sm text-gray-500 mt-auto">{subtext}</p>
        )}
        {metric}
      </div>
    </Card>
  );

  const PerformanceCard = ({
    label,
    item,
    type,
  }: {
    label: string;
    item: any;
    type: 'best' | 'worst';
  }) => {
    if (!item) return null;
    return (
      <div
        className={`mt-2 p-2 rounded ${
          type === 'best' ? 'bg-green-50' : 'bg-red-50'
        } border border-opacity-20 ${
          type === 'best' ? 'border-green-500' : 'border-red-500'
        }`}
      >
        <div className="flex items-center justify-between mb-1">
          <span
            className={`text-xs font-bold uppercase ${
              type === 'best' ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {label}
          </span>
          <span className="text-xs font-mono">
            {item.normalized_delta > 0 ? '+' : ''}
            {(item.normalized_delta * 100).toFixed(1)}%
          </span>
        </div>
        <ListingThumbnail
          preview={item.preview}
          onClick={() =>
            navigate('listing', { id: item.preview.listing_id })
          }
        />
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-7xl mx-auto">
      <h1 className="font-serif text-3xl font-bold text-gray-900">
        Dashboard Overview
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="flex flex-col gap-4">
          <StatCard
            title="Active Experiments"
            count={data.active_experiments.count}
            onClick={() => navigate('experiments', { tab: 'active' })}
            subtext="Click to view details"
          />
          {(data.active_experiments.best ||
            data.active_experiments.worst) && (
            <Card className="flex-1">
              <h4 className="font-serif font-bold text-sm mb-2">
                Performance Watch
              </h4>
              <PerformanceCard
                label="Best Performing"
                item={data.active_experiments.best}
                type="best"
              />
              <PerformanceCard
                label="Worst Performing"
                item={data.active_experiments.worst}
                type="worst"
              />
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <StatCard
            title="Finished"
            count={data.finished_experiments.count}
            onClick={() => navigate('experiments', { tab: 'finished' })}
            subtext="Waiting for review"
          />
          {(data.finished_experiments.best ||
            data.finished_experiments.worst) && (
            <Card className="flex-1">
              <h4 className="font-serif font-bold text-sm mb-2">Results In</h4>
              <PerformanceCard
                label="Best Performing"
                item={data.finished_experiments.best}
                type="best"
              />
              <PerformanceCard
                label="Worst Performing"
                item={data.finished_experiments.worst}
                type="worst"
              />
            </Card>
          )}
        </div>

        <StatCard
          title="Active Insights"
          count={data.insights.active_count}
          onClick={() => navigate('insights')}
          subtext="Driving generation"
        />

        <StatCard
          title="Proposals"
          count={data.proposals.count}
          onClick={() => navigate('experiments', { tab: 'proposals' })}
          subtext="Ready to approve"
        />
      </div>

      <Card className="bg-gradient-to-br from-[#0573bb] to-[#0a8bdf] text-white border-none">
        <h3 className="font-serif text-xl font-bold mb-4">
          Completed Experiments
        </h3>
        <div className="flex flex-wrap gap-12">
          <div>
            <div className="text-3xl font-bold">
              {data.completed.count}
            </div>
            <div className="text-sm opacity-80">Total Run</div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {(data.completed.percent_kept || 0).toFixed(1)}%
            </div>
            <div className="text-sm opacity-80">Percent Kept</div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {data.completed.avg_normalized_delta_kept > 0 ? '+' : ''}
              {((data.completed.avg_normalized_delta_kept || 0) * 100).toFixed(
                1,
              )}
              %
            </div>
            <div className="text-sm opacity-80">Avg. Increase (Kept)</div>
          </div>
        </div>
      </Card>
    </div>
  );
};
