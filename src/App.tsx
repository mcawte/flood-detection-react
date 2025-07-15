/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fromArrayBuffer, GeoTIFF } from "geotiff";
import { ImageMetadata, Feature, FeatureCollection } from "./interfaces";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
// Aliasing the imported Map component to avoid a naming conflict
import MapComponent from "./components/MapComponent";

function App() {
  const [geoTiff, setGeoTiff] = useState<GeoTIFF | null>(null);
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(
    null
  );
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [imageOverlay, setImageOverlay] = useState<L.ImageOverlay | null>(null);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(true);
  const [roadLayers, setRoadLayers] = useState<L.GeoJSON | null>(null);

  const [affectedRoads, setAffectedRoads] = useState<Feature[]>([]);
  const [nearFloodRoads, setNearFloodRoads] = useState<Feature[]>([]);
  const [floodPixelData, setFloodPixelData] = useState<Uint8Array | null>(null);
  const [floodBounds, setFloodBounds] = useState<L.LatLngBounds | null>(null);

  const [floodAreaDisplay, setFloodAreaDisplay] = useState<string>("N/A");

  // Load real road data from OpenStreetMap
  const loadRealRoadData = async () => {
    if (!mapInstance) return;

    // Get the current map bounds
    const bounds = mapInstance.getBounds();
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

    // Create the Overpass API query - get roads within the current map view
    const overpassQuery = `
      [out:json];
      (
        way["highway"]["highway"!="footway"]["highway"!="path"]["highway"!="cycleway"]["highway"!="steps"]
          (${south},${west},${north},${east});
      );
      out body;
      >;
      out skel qt;
    `;

    try {
      // Use a proxy or direct Overpass API endpoint
      const response = await fetch(`https://overpass-api.de/api/interpreter`, {
        method: "POST",
        body: overpassQuery,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch OSM data: ${response.status}`);
      }

      const data = await response.json();
      console.log("Retrieved OSM data:", data);

      // Process the OSM data into GeoJSON
      const osmToGeoJSON = processOSMtoGeoJSON(data);

      // Remove any existing road layers
      if (roadLayers) {
        roadLayers.removeFrom(mapInstance);
      }

      // Create and style the GeoJSON layer for roads
      const roadsGeoJSON = L.geoJSON(osmToGeoJSON, {
        style: (feature) => {
          const props = feature?.properties || {};
          const highway = props.highway;

          // Style roads based on their type
          if (
            highway === "motorway" ||
            highway === "trunk" ||
            highway === "primary"
          ) {
            return { color: "#3388ff", weight: 5, opacity: 0.7 };
          } else if (highway === "secondary" || highway === "tertiary") {
            return { color: "#3388ff", weight: 3, opacity: 0.7 };
          } else {
            return { color: "#777777", weight: 2, opacity: 0.7 };
          }
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties) {
            layer.bindTooltip(
              `${feature.properties.name || "Unnamed road"} (${
                feature.properties.highway
              })`
            );
          }
        },
      }).addTo(mapInstance);

      setRoadLayers(roadsGeoJSON);

      // If there's flood data, analyze road impacts
      if (floodPixelData && floodBounds && imageMetadata) {
        analyzeRoadImpact(
          roadsGeoJSON,
          floodPixelData,
          floodBounds,
          imageMetadata
        );
      }
    } catch (error) {
      console.error("Error loading road data:", error);
      alert("Error loading road data. Please try again.");
    }
  };

  // Process OSM data to GeoJSON format - fixed typing
  const processOSMtoGeoJSON = (osmData: any): FeatureCollection => {
    // Map to store nodes
    const nodes = new Map(); // This now correctly refers to the JavaScript Map object

    // Extract all nodes
    osmData.elements.forEach((element: any) => {
      if (element.type === "node") {
        nodes.set(element.id, { lat: element.lat, lon: element.lon });
      }
    });

    // Create GeoJSON features from ways
    const features: Feature[] = osmData.elements
      .filter(
        (element: any) =>
          element.type === "way" && element.tags && element.tags.highway
      )
      .map((way: any): Feature => {
        // Create coordinates array for the LineString
        const coordinates = way.nodes
          .map((nodeId: number) => {
            const node = nodes.get(nodeId);
            return node ? [node.lon, node.lat] : null;
          })
          .filter((coord: any) => coord !== null);

        // Return a GeoJSON feature
        return {
          type: "Feature",
          properties: {
            id: way.id,
            ...way.tags,
            name: way.tags.name || `Road-${way.id}`,
          },
          geometry: {
            type: "LineString",
            coordinates,
          },
        };
      });

    return {
      type: "FeatureCollection",
      features,
    } as FeatureCollection;
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !mapInstance) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();

      const metadata: ImageMetadata = {
        width: image.getWidth(),
        height: image.getHeight(),
        bounds: image.getBoundingBox(),
        crs: image.getGDALMetadata()?.SRS || "Unknown",
        origin: image.getOrigin(),
        resolution: image.getResolution(),
        bands: image.getSamplesPerPixel(),
      };

      setGeoTiff(tiff);
      setImageMetadata(metadata);

      // --- Visualization Logic ---
      if (mapInstance) {
        // 1. Get Bounds in Lat/Lng (EPSG:4326)
        const boundsLatLng: L.LatLngBoundsLiteral = [
          [metadata.bounds[1], metadata.bounds[0]], // Southwest corner [lat, lng]
          [metadata.bounds[3], metadata.bounds[2]], // Northeast corner [lat, lng]
        ];

        const leafletBounds = L.latLngBounds(boundsLatLng);
        setFloodBounds(leafletBounds);

        // 2. Read Raster Data (e.g., first band)
        const rasters = await image.readRasters({
          window: [0, 0, metadata.width, metadata.height],
        });
        const bandData = rasters[0]; // Type is TypedArray | number[]

        // Store the flood pixel data for later use in road analysis
        if (typeof bandData !== "number") {
          // Convert to Uint8Array for consistency
          const floodMaskArray = new Uint8Array(bandData.length);
          for (let i = 0; i < bandData.length; i++) {
            floodMaskArray[i] = bandData[i] === 1 ? 1 : 0;
          }
          setFloodPixelData(floodMaskArray);
        }

        // 3. Create Canvas for Overlay
        const canvas = document.createElement("canvas");
        canvas.width = metadata.width;
        canvas.height = metadata.height;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          const imageData = ctx.createImageData(
            metadata.width,
            metadata.height
          );
          const data = imageData.data; // Uint8ClampedArray: [R, G, B, A, R, G, B, A, ...]

          // 4. Style Pixels based on Value
          if (typeof bandData === "number") {
            console.warn(
              "Band data is a single number:",
              bandData,
              "- Cannot visualize."
            );
          } else {
            for (let i = 0; i < bandData.length; i++) {
              const pixelValue = bandData[i];
              const dataIndex = i * 4;

              // Flood areas in blue with semi-transparency
              if (pixelValue === 1) {
                data[dataIndex] = 0; // R
                data[dataIndex + 1] = 100; // G
                data[dataIndex + 2] = 255; // B
                data[dataIndex + 3] = 150; // A (semi-transparent)
              } else {
                // Make other areas transparent
                data[dataIndex + 3] = 0; // A
              }
            }
            ctx.putImageData(imageData, 0, 0);
          }

          // 5. Create/Update Leaflet Image Overlay
          const imageUrl = canvas.toDataURL();

          // Remove old overlay if it exists
          if (imageOverlay) {
            imageOverlay.remove();
          }

          // Create new overlay
          const newOverlay = L.imageOverlay(imageUrl, leafletBounds, {
            opacity: 0.7,
          }).addTo(mapInstance);
          setImageOverlay(newOverlay);

          // 6. Fit Map to Bounds
          mapInstance.flyToBounds(leafletBounds);

          // 7. Load road data for this area
          loadRealRoadData();

          // 8. Calculate flood area
          calculateFloodArea();
        } else {
          console.error("Could not get 2D context from canvas");
        }
      }
    } catch (error) {
      console.error("Error processing GeoTIFF file:", error);
      alert("Failed to process GeoTIFF file. Check console for details.");

      // Reset state
      setGeoTiff(null);
      setImageMetadata(null);
      if (imageOverlay) {
        imageOverlay.remove();
        setImageOverlay(null);
      }
    }
  };

  // Function to analyze impact of flooding on roads
  const analyzeRoadImpact = (
    roadsLayer: L.GeoJSON,
    floodPixelData: Uint8Array,
    floodBounds: L.LatLngBounds,
    metadata: ImageMetadata
  ) => {
    if (!mapInstance) return;

    const affectedRoadsList: Feature[] = [];
    const nearFloodRoadsList: Feature[] = [];

    // Process each road feature
    roadsLayer.eachLayer((layer: any) => {
      if (layer.feature && layer.feature.geometry.type === "LineString") {
        // Check if the road intersects with the flood area
        const roadLine = layer.getLatLngs();

        let isInFlood = false;
        let isNearFlood = false;

        // Check each point in the road
        for (const point of roadLine) {
          // Skip if this point is outside the flood bounds
          if (!floodBounds.contains(point)) continue;

          // Convert lat/lng to pixel coordinates in the GeoTIFF
          const normalizedX =
            (point.lng - metadata.bounds[0]) /
            (metadata.bounds[2] - metadata.bounds[0]);
          const normalizedY =
            1 -
            (point.lat - metadata.bounds[1]) /
              (metadata.bounds[3] - metadata.bounds[1]);

          const pixelX = Math.floor(normalizedX * metadata.width);
          const pixelY = Math.floor(normalizedY * metadata.height);

          // Get the pixel index
          const pixelIndex = pixelY * metadata.width + pixelX;

          // Check if this point is in flood area
          if (
            pixelIndex >= 0 &&
            pixelIndex < floodPixelData.length &&
            floodPixelData[pixelIndex] === 1
          ) {
            isInFlood = true;
            break;
          }

          // Check nearby pixels for "near flood" status (simple approach)
          const checkNearby = (x: number, y: number) => {
            const idx = y * metadata.width + x;
            return (
              idx >= 0 &&
              idx < floodPixelData.length &&
              floodPixelData[idx] === 1
            );
          };

          // Check in a small square around the point
          const bufferPixels = 5; // About 5 pixels around
          for (let dx = -bufferPixels; dx <= bufferPixels; dx++) {
            for (let dy = -bufferPixels; dy <= bufferPixels; dy++) {
              if (checkNearby(pixelX + dx, pixelY + dy)) {
                isNearFlood = true;
                break;
              }
            }
            if (isNearFlood) break;
          }
        }

        // Update road styling based on flood status
        if (isInFlood) {
          layer.setStyle({ color: "#ff0000", weight: 5, opacity: 0.9 });
          affectedRoadsList.push(layer.feature);
        } else if (isNearFlood) {
          layer.setStyle({ color: "#ff7800", weight: 4, opacity: 0.8 });
          nearFloodRoadsList.push(layer.feature);
        }
      }
    });

    setAffectedRoads(affectedRoadsList);
    setNearFloodRoads(nearFloodRoadsList);

    console.log(`Found ${affectedRoadsList.length} roads in flood areas`);
    console.log(`Found ${nearFloodRoadsList.length} roads near flood areas`);
  };

  // Function to calculate flood area
  const calculateFloodArea = async () => {
    if (!imageMetadata || !geoTiff) return;

    try {
      const image = await geoTiff.getImage();
      const rasters = await image.readRasters({
        window: [0, 0, imageMetadata.width, imageMetadata.height],
      });
      const bandData = rasters[0];

      if (typeof bandData === "number") {
        console.warn(
          "Band data is a single number:",
          bandData,
          "- Cannot calculate area."
        );
        setFloodAreaDisplay("Cannot calculate (invalid data)");
        return;
      }

      // Count flood pixels (value 1)
      let floodPixelCount = 0;
      for (let i = 0; i < bandData.length; i++) {
        if (bandData[i] === 1) floodPixelCount++;
      }

      // Calculate pixel area in square meters (assuming projected CRS)
      const pixelArea = Math.abs(
        imageMetadata.resolution[0] * imageMetadata.resolution[1]
      );

      // Calculate total flood area
      const totalFloodArea = floodPixelCount * pixelArea; // In native CRS units (e.g., m²)

      // Convert to km²
      const floodAreaKm2 = totalFloodArea / 1_000_000;

      setFloodAreaDisplay(`${floodAreaKm2.toFixed(2)} km² (approx.)`);
    } catch (error) {
      console.error("Error calculating flood area:", error);
      setFloodAreaDisplay("Calculation error");
    }
  };

  const toggleOverlay = () => {
    if (!mapInstance || !imageOverlay) return;

    if (overlayVisible) {
      imageOverlay.remove();
      setOverlayVisible(false);
    } else {
      imageOverlay.addTo(mapInstance);
      setOverlayVisible(true);
    }
  };

  // Manually refresh road data (can be used after flood data is loaded)
  const refreshRoadData = () => {
    loadRealRoadData();
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          handleFileChange={handleFileChange}
          floodAreaDisplay={floodAreaDisplay}
          imageMetadata={imageMetadata}
          affectedRoads={affectedRoads}
          nearFloodRoads={nearFloodRoads}
          toggleOverlay={toggleOverlay}
          overlayVisible={overlayVisible}
          refreshRoadData={refreshRoadData}
          imageOverlay={imageOverlay}
          mapInstance={mapInstance}
        />
        {/* Using the aliased component name */}
        <MapComponent setMapInstance={setMapInstance} />
      </div>
    </div>
  );
}

export default App;
