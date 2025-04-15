import React, { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fromArrayBuffer, GeoTIFF } from 'geotiff'; // Removed unused TypedArray import

// Define an interface for better type safety
interface ImageMetadata {
  width: number;
  height: number;
  bounds: number[]; // [minX, minY, maxX, maxY]
  crs: string;
  origin: number[];
  resolution: number[];
  bands: number;
}

function App() {
  const [geoTiff, setGeoTiff] = useState<GeoTIFF | null>(null); // Use GeoTIFF type
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(null); // Use ImageMetadata type
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [imageOverlay, setImageOverlay] = useState<L.ImageOverlay | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Leaflet map
  useEffect(() => {
    if (mapContainerRef.current && !mapInstance) {
      const map = L.map(mapContainerRef.current).setView([0, 0], 2); // Default view
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      setMapInstance(map);
    }

    // Cleanup map instance on component unmount
    return () => {
      mapInstance?.remove();
    };
  }, [mapContainerRef.current]); // Re-run if map container ref changes

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage(); // Get the first image
      const metadata = {
        width: image.getWidth(),
        height: image.getHeight(),
        bounds: image.getBoundingBox(), // EPSG:4326 if available, otherwise native CRS
        crs: image.getGDALMetadata()?.SRS || 'Unknown', // Attempt to get CRS
        origin: image.getOrigin(),
        resolution: image.getResolution(),
        bands: image.getSamplesPerPixel(),
        // Add more metadata extraction as needed
      };

      console.log('GeoTIFF parsed:', tiff);
      console.log('Image metadata:', metadata);

      setGeoTiff(tiff);
      setImageMetadata(metadata);

      // --- Visualization Logic ---
      if (mapInstance) {
        // 1. Get Bounds in Lat/Lng (EPSG:4326)
        // geotiff.js usually provides bounds in the image's native CRS.
        // We need to reproject if it's not EPSG:4326.
        // For simplicity, assuming bounds are already EPSG:4326 for now.
        // A robust solution would involve proj4js or similar for reprojection.
        const boundsLatLng: L.LatLngBoundsLiteral = [
          [metadata.bounds[1], metadata.bounds[0]], // Southwest corner [lat, lng]
          [metadata.bounds[3], metadata.bounds[2]]  // Northeast corner [lat, lng]
        ];

        // 2. Read Raster Data (e.g., first band)
        // readRasters returns Promise<(TypedArray|Array)[]>
        // We expect a single band (TypedArray or Array) for the mask
        const rasters = await image.readRasters({ window: [0, 0, metadata.width, metadata.height] });
        const bandData = rasters[0]; // Type is TypedArray | number[]

        // 3. Create Canvas for Overlay
        const canvas = document.createElement('canvas');
        canvas.width = metadata.width;
        canvas.height = metadata.height;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          const imageData = ctx.createImageData(metadata.width, metadata.height);
          const data = imageData.data; // Uint8ClampedArray: [R, G, B, A, R, G, B, A, ...]

          // 4. Style Pixels based on Value
          // Add type guard to handle potential 'number' type for bandData
          if (typeof bandData === 'number') {
            console.warn("Band data is a single number:", bandData, "- Cannot visualize.");
            // Handle this unlikely case - perhaps show an error or do nothing
          } else {
            // Now TypeScript knows bandData is TypedArray | number[] here
            for (let i = 0; i < bandData.length; i++) {
              const pixelValue = bandData[i]; // Access element directly
              const dataIndex = i * 4;

              // Example styling: Red for flood (value 1), transparent otherwise
            if (pixelValue === 1) { // Adjust this condition based on your mask values
              data[dataIndex] = 255;     // R
              data[dataIndex + 1] = 0;   // G
              data[dataIndex + 2] = 0;   // B
              data[dataIndex + 3] = 150; // A (semi-transparent)
            } else {
              // Make other areas transparent
              data[dataIndex + 3] = 0;   // A
            }
          }
            ctx.putImageData(imageData, 0, 0);
          } // End of else block for type guard

          // 5. Create/Update Leaflet Image Overlay
          const imageUrl = canvas.toDataURL();
          const leafletBounds = L.latLngBounds(boundsLatLng); // Create LatLngBounds object

          if (imageOverlay) {
            imageOverlay.setUrl(imageUrl).setBounds(leafletBounds);
          } else {
            const newOverlay = L.imageOverlay(imageUrl, leafletBounds, { opacity: 0.7 }).addTo(mapInstance);
            setImageOverlay(newOverlay);
          }

          // 6. Fit Map to Bounds
          mapInstance.flyToBounds(leafletBounds); // Use LatLngBounds object
        } else {
          console.error("Could not get 2D context from canvas");
        }
      }

    } catch (error) {
      console.error('Error processing GeoTIFF file:', error);
      alert('Failed to process GeoTIFF file. Check console for details.');
      setGeoTiff(null);
      setImageMetadata(null);
      // Remove overlay if processing fails
      if (imageOverlay) {
        imageOverlay.remove();
        setImageOverlay(null);
      }
    }
  };

  // Function to calculate flood area (basic example)
  const calculateFloodArea = () => {
    if (!imageMetadata || !geoTiff) return 'N/A';

    // This is a very simplified calculation assuming pixels are square
    // and the CRS is projected (like UTM) where units are meters.
    // For geographic CRS (lat/lon), area calculation is more complex.
    // Also assumes band 0 is the flood mask and value 1 indicates flood.
    // A proper implementation needs CRS handling and accurate pixel area calculation.

    // Placeholder: Count flood pixels (value 1)
    // let floodPixelCount = 0;
    // const bandData = ... // Need to re-read or store band data
    // bandData.forEach(val => { if (val === 1) floodPixelCount++; });
    // const pixelArea = Math.abs(metadata.resolution[0] * metadata.resolution[1]); // Area per pixel
    // const totalFloodArea = floodPixelCount * pixelArea; // In native CRS units (e.g., m^2)
    // const floodAreaKm2 = totalFloodArea / 1_000_000;
    // return `${floodAreaKm2.toFixed(2)} km² (approx.)`;

    return 'Calculation needs implementation'; // Placeholder
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <h1 className="text-2xl font-bold">GeoTIFF Flood Map Viewer</h1>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-1/4 bg-white p-4 overflow-y-auto shadow-lg">
          <h2 className="text-xl font-semibold mb-4 border-b pb-2">Controls & Info</h2>

          {/* File Upload */}
          <div className="mb-4">
            <label htmlFor="geotiff-upload" className="block text-sm font-medium text-gray-700 mb-1">
              Upload GeoTIFF (.tif)
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

          {/* Metadata Display */}
          {imageMetadata && (
            <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
              <h3 className="text-lg font-semibold mb-2">Image Metadata</h3>
              <ul className="text-sm space-y-1">
                <li><strong>Width:</strong> {imageMetadata.width} px</li>
                <li><strong>Height:</strong> {imageMetadata.height} px</li>
                <li><strong>Bands:</strong> {imageMetadata.bands}</li>
                <li><strong>CRS:</strong> {imageMetadata.crs}</li>
                <li><strong>Bounds:</strong> {JSON.stringify(imageMetadata.bounds)}</li>
                {/* Add more metadata fields */}
                <li><strong>Flood Area:</strong> {calculateFloodArea()}</li>
              </ul>
            </div>
          )}

          {/* Legend */}
          {imageOverlay && (
             <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
               <h3 className="text-lg font-semibold mb-2">Legend</h3>
               <div className="flex items-center">
                 <span className="w-4 h-4 bg-red-500 opacity-70 mr-2 inline-block"></span>
                 <span>Flood Zone (Mask Value 1)</span>
               </div>
               {/* Add more legend items if needed */}
             </div>
          )}

           {/* Overlay Toggle (Example) */}
           {imageOverlay && mapInstance && (
             <button
               onClick={() => {
                 if (mapInstance.hasLayer(imageOverlay)) {
                   imageOverlay.remove();
                 } else {
                   imageOverlay.addTo(mapInstance);
                 }
                 // Force re-render or update state to change button text if needed
               }}
               className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
             >
               Toggle Flood Overlay
             </button>
           )}

        </aside>

        {/* Map Area */}
        <main className="flex-1 relative">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
        </main>
      </div>
    </div>
  );
}

export default App;
