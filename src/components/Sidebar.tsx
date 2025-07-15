import React from 'react';
import { ImageMetadata, Feature } from '../interfaces';

interface SidebarProps {
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  floodAreaDisplay: string;
  imageMetadata: ImageMetadata | null;
  affectedRoads: Feature[];
  nearFloodRoads: Feature[];
  toggleOverlay: () => void;
  overlayVisible: boolean;
  refreshRoadData: () => void;
  imageOverlay: L.ImageOverlay | null;
  mapInstance: L.Map | null;
}

const Sidebar: React.FC<SidebarProps> = ({
  handleFileChange,
  floodAreaDisplay,
  imageMetadata,
  affectedRoads,
  nearFloodRoads,
  toggleOverlay,
  overlayVisible,
  refreshRoadData,
  imageOverlay,
  mapInstance,
}) => {
  return (
    <aside className="w-1/4 bg-white p-4 overflow-y-auto shadow-lg">
      <h2 className="text-xl font-semibold mb-4 border-b pb-2">
        Logistics Control Center
      </h2>

      {/* File Upload */}
      <div className="mb-4">
        <label
          htmlFor="geotiff-upload"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Upload Flood Data (.tif)
        </label>
        <input
          id="geotiff-upload"
          type="file"
          accept=".tif,.tiff"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500
                     file:mr-4 file:py-2 file:px-4
                     file:rounded-full file:border-0
                     file:text-sm file:font-semibold
                     file:bg-blue-50 file:text-blue-700
                     hover:file:bg-blue-100"
        />
      </div>

      {/* Flood Analytics */}
      <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
        <h3 className="text-lg font-semibold mb-2">Flood Analytics</h3>
        <ul className="text-sm space-y-1">
          <li>
            <strong>Flood Area:</strong> {floodAreaDisplay}
          </li>
          {imageMetadata && (
            <>
              <li>
                <strong>Image Dimensions:</strong> {imageMetadata.width} x{' '}
                {imageMetadata.height} px
              </li>
              <li>
                <strong>Coordinate System:</strong> {imageMetadata.crs}
              </li>
            </>
          )}
        </ul>
      </div>

      {/* Road Impact Analysis */}
      <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
        <h3 className="text-lg font-semibold mb-2">Road Impact Analysis</h3>
        {affectedRoads.length > 0 || nearFloodRoads.length > 0 ? (
          <>
            {affectedRoads.length > 0 && (
              <div className="mb-3">
                <div className="text-sm font-medium text-red-600 mb-2">
                  {affectedRoads.length} roads affected by flooding!
                </div>
                <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
                  {affectedRoads.slice(0, 10).map((road, index) => (
                    <li key={`affected-${index}`} className="flex items-center">
                      <span className="w-3 h-3 bg-red-500 mr-2 inline-block"></span>
                      {road.properties?.name || `Road ${road.properties?.id}`}
                    </li>
                  ))}
                  {affectedRoads.length > 10 && (
                    <li className="text-xs text-gray-600">
                      + {affectedRoads.length - 10} more roads
                    </li>
                  )}
                </ul>
              </div>
            )}

            {nearFloodRoads.length > 0 && (
              <div>
                <div className="text-sm font-medium text-orange-600 mb-2">
                  {nearFloodRoads.length} roads near flood zones:
                </div>
                <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
                  {nearFloodRoads.slice(0, 10).map((road, index) => (
                    <li key={`near-${index}`} className="flex items-center">
                      <span className="w-3 h-3 bg-orange-500 mr-2 inline-block"></span>
                      {road.properties?.name || `Road ${road.properties?.id}`}
                    </li>
                  ))}
                  {nearFloodRoads.length > 10 && (
                    <li className="text-xs text-gray-600">
                      + {nearFloodRoads.length - 10} more roads
                    </li>
                  )}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600">
            All roads operating normally.
          </p>
        )}
      </div>

      {/* Map Legend */}
      <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
        <h3 className="text-lg font-semibold mb-2">Map Legend</h3>
        <div className="space-y-2">
          <div className="flex items-center">
            <span className="w-4 h-4 bg-blue-500 opacity-70 mr-2 inline-block"></span>
            <span className="text-sm">Flood Area</span>
          </div>
          <div className="flex items-center">
            <span className="w-4 h-4 bg-red-500 mr-2 inline-block"></span>
            <span className="text-sm">Flooded Road</span>
          </div>
          <div className="flex items-center">
            <span className="w-4 h-4 bg-orange-500 mr-2 inline-block"></span>
            <span className="text-sm">Road Near Flood Zone</span>
          </div>
          <div className="flex items-center">
            <span
              className="w-4 h-4 mr-2 inline-block"
              style={{ backgroundColor: '#3388ff' }}
            ></span>
            <span className="text-sm">Major Road</span>
          </div>
          <div className="flex items-center">
            <span
              className="w-4 h-4 mr-2 inline-block"
              style={{ backgroundColor: '#777777' }}
            ></span>
            <span className="text-sm">Minor Road</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-2">
        {imageOverlay && mapInstance && (
          <button
            onClick={toggleOverlay}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
          >
            {overlayVisible ? 'Hide Flood Overlay' : 'Show Flood Overlay'}
          </button>
        )}

        <button
          onClick={refreshRoadData}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
        >
          Refresh Road Data
        </button>

        <button className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out">
          Alert Emergency Services
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;