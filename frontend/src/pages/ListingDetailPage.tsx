import { useEffect, useState } from 'react';
import { api, getImageUrl } from '../api';
import { Badge, Card } from '../components/ui';

export const ListingDetailPage = ({
  id,
  onBack,
}: {
  id: number;
  onBack: () => void;
}) => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get(`/listings/${id}`).then(setData);
  }, [id]);

  if (!data) return <div className="p-10">Loading Listing...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="mb-4 text-gray-500 hover:text-gray-800 flex items-center gap-1"
      >
        <span className="w-4 h-4 rotate-180 inline-block">{'➜'}</span> Back to
        List
      </button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="col-span-1">
          <img
            src={getImageUrl(
              data.images?.files?.[0]?.path ||
                data.images?.results?.[0]?.url_570xN,
            )}
            className="w-full rounded shadow-lg mb-4"
          />
        </div>

        <div className="col-span-2 space-y-4">
          <div>
            <h1 className="font-serif text-2xl font-bold text-gray-900 mb-2">
              {data.listing.title}
            </h1>
            <p className="text-sm text-gray-600 mb-2">
              Listing ID: {data.listing.listing_id}
            </p>
            <Badge>{data.listing.state}</Badge>
          </div>

          <Card>
            <h3 className="font-serif text-lg font-bold mb-3">
              Core Stats (Last 30 Days)
            </h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">
                  {data.listing.views}
                </div>
                <div className="text-xs uppercase text-gray-500">
                  Total Views
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {data.listing.num_favorers}
                </div>
                <div className="text-xs uppercase text-gray-500">
                  Favorites
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {data.listing.quantity}
                </div>
                <div className="text-xs uppercase text-gray-500">
                  Stock
                </div>
              </div>
            </div>
          </Card>

          <div>
            <h3 className="font-serif text-lg font-bold mb-3 border-b pb-2">
              Experiment History
            </h3>
            <div className="space-y-3">
              {data.tested_experiments.map((exp: any) => (
                <div
                  key={exp.experiment_id}
                  className="flex justify-between items-center text-sm p-3 bg-white border rounded"
                >
                  <div>
                    <div className="font-bold">
                      {exp.changes?.[0]?.change_type || 'Experiment'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {exp.start_date?.split('T')[0]} to{' '}
                      {exp.end_date?.split('T')[0]}
                    </div>
                  </div>
                  <Badge color={exp.state === 'kept' ? 'green' : 'gray'}>
                    {exp.state}
                  </Badge>
                </div>
              ))}
              {data.tested_experiments.length === 0 && (
                <p className="text-gray-500 italic">No past experiments.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
