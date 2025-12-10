import React, { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { api } from '../api';
import { Button, Card } from '../components/ui';
import type { Report, Insight } from '../types';
import { COLORS } from '../config';

export const ReportsPage = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [activeInsights, setActiveInsights] = useState<Insight[]>([]);

  const refresh = () => {
    api.get('/reports').then(d => setReports(d.results));
    api.get('/insights/active').then(d => setActiveInsights(d.results));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreateReport = async () => {
    try {
      await api.post('/reports', { days_back: 30 });
      refresh();
    } catch {
      alert('Error generating report');
    }
  };

  const handleActivateInsight = async (reportId: string, insightId: string) => {
    try {
      await api.post(`/reports/${reportId}/activate_insights`, {
        insight_ids: [insightId],
      });
      refresh();
    } catch {
      alert('Failed to activate');
    }
  };

  const handleDeactivateInsight = async (insightId: string) => {
    try {
      await api.delete(`/insights/active/${insightId}`);
      refresh();
    } catch {
      alert('Failed to deactivate');
    }
  };

  const mostRecentReport =
    reports.length > 0 ? reports[reports.length - 1] : null;

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      <section>
        <div className="flex justify-between items-center mb-4">
          <h2
            className="font-serif text-2xl font-bold text-[color:var(--primary)]"
            style={{ '--primary': COLORS.primary } as React.CSSProperties}
          >
            Active Insights ({activeInsights.length})
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeInsights.map(insight => (
            <Card
              key={insight.insight_id}
              className="bg-yellow-50 border-yellow-200"
            >
              <div className="flex justify-between items-start">
                <div>
                  <Lightbulb className="w-5 h-5 text-yellow-600 mb-2" />
                  <p className="font-medium text-gray-800">{insight.text}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    {insight.reasoning}
                  </p>
                </div>
                <button
                  onClick={() =>
                    handleDeactivateInsight(insight.insight_id)
                  }
                  className="text-gray-400 hover:text-red-500 text-xs"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
          {activeInsights.length === 0 && (
            <p className="text-gray-500 italic">
              No active insights driving generation.
            </p>
          )}
        </div>
      </section>

      <section className="border-t pt-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-serif text-2xl font-bold text-gray-900">
            Latest Report
          </h2>
          <Button onClick={handleCreateReport}>
            Generate New Report (30 Days)
          </Button>
        </div>

        {mostRecentReport ? (
          <Card className="border-l-4 border-l-blue-500 shadow-md">
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <div className="text-sm font-bold text-gray-500 uppercase tracking-wide">
                  Period: {mostRecentReport.window_start} —{' '}
                  {mostRecentReport.window_end}
                </div>
                <span className="text-xs text-gray-400">
                  ID: {mostRecentReport.report_id}
                </span>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg font-serif text-gray-800 whitespace-pre-wrap leading-relaxed">
                {mostRecentReport.report_markdown}
              </div>
            </div>

            <div className="bg-white border rounded-lg p-4">
              <h4 className="font-bold text-sm mb-3 text-gray-900 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-500" /> Actionable
                Insights Found
              </h4>
              <div className="space-y-2">
                {mostRecentReport.insights.map((insight: any) => {
                  const isActive = activeInsights.some(
                    ai => ai.insight_id === insight.insight_id,
                  );
                  return (
                    <div
                      key={insight.insight_id}
                      className="flex items-center gap-3 text-sm p-3 rounded hover:bg-gray-50 transition-colors border-b last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        disabled={isActive}
                        onChange={() =>
                          !isActive &&
                          handleActivateInsight(
                            mostRecentReport.report_id,
                            insight.insight_id,
                          )
                        }
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <span className="font-medium text-gray-900">
                          {insight.text}
                        </span>
                      </div>
                      {isActive && (
                        <span className="text-green-600 text-xs font-bold px-2 py-1 bg-green-50 rounded">
                          Active
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        ) : (
          <div className="text-center py-10 bg-gray-50 rounded border border-dashed">
            <p className="text-gray-500">No reports generated yet.</p>
          </div>
        )}

        {reports.length > 1 && (
          <div className="mt-8">
            <h3 className="font-serif text-lg font-bold text-gray-600 mb-4">
              Past Reports
            </h3>
            <div className="space-y-2 opacity-75 hover:opacity-100 transition-opacity">
              {reports
                .slice(0, reports.length - 1)
                .reverse()
                .map(r => (
                  <div
                    key={r.report_id}
                    className="p-3 bg-white border rounded text-sm flex justify-between"
                  >
                    <span>
                      {r.window_start} - {r.window_end}
                    </span>
                    <span className="text-gray-400 text-xs">Archived</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
