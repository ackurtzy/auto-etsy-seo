import { useEffect, useState } from 'react';
import { FlaskConical, ArrowRight } from 'lucide-react';
import { api } from '../api';
import { Button, Card, Badge } from '../components/ui';
import { ListingThumbnail } from '../components/ListingThumbnail';

export const ListingsPage = ({ navigate }: { navigate: any }) => {
  const [listings, setListings] = useState<any[]>([]);

  useEffect(() => {
    api.get('/listings').then(d => setListings(d.results));
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="font-serif text-3xl font-bold text-gray-900 mb-6">
        Listings Catalog
      </h1>
      <div className="grid grid-cols-1 gap-4">
        {listings.map(l => (
          <Card
            key={l.listing_id}
            className="flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <ListingThumbnail
                preview={l.preview}
                onClick={() => navigate('listing', { id: l.listing_id })}
              />
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium text-gray-900">
                  {l.title}
                </div>
                <div className="flex gap-2">
                  <Badge>{l.state}</Badge>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <FlaskConical size={12} /> {l.experiment_count} Exp. Run
                  </span>
                  <span className="text-xs text-green-600 font-bold">
                    Lifetime:{' '}
                    {`+${(l.lifetime_kept_normalized_delta * 100).toFixed(1)}%`}
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('listing', { id: l.listing_id })}
            >
              Details <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
};
