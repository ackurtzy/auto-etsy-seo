import React from 'react';
import type { ListingPreview } from '../types';
import { COLORS } from '../config';
import { getImageUrl } from '../api';

export const ListingThumbnail = ({
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
      alt={preview.title}
      className="w-12 h-12 object-cover rounded border border-gray-200"
    />
    <div>
      <h4
        className="font-sans text-sm font-medium text-gray-900 group-hover:text-[color:var(--primary)] truncate w-48"
        style={{ '--primary': COLORS.primary } as React.CSSProperties}
      >
        {preview.title_30}...
      </h4>
      <span className="text-xs text-gray-500">ID: {preview.listing_id}</span>
    </div>
  </div>
);
