/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fromArrayBuffer, GeoTIFFImage } from "geotiff";
import { ImageMetadata, Feature, FeatureCollection } from "./interfaces";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import MapComponent from "./components/MapComponent";

// Define a type for our OSM node coordinates for clarity
type NodeCoords = { lat: number; lon: number };

function App() {
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

  const getCRS = (image: GeoTIFFImage): string => {
    try {
      const geoKeys = image.getGeoKeys();
      if (geoKeys?.GTCitationGeoKey) return geoKeys.GTCitationGeoKey;
      if (geoKeys?.ProjectedCSTypeGeoKey)
        return `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
      if (geoKeys?.GeographicTypeGeoKey)
        return `EPSG:${geoKeys.GeographicTypeGeoKey}`;
      return "Not Found";
    } catch {
      return "Error reading CRS";
    }
  };

  const loadRealRoadData = async () => {
    if (!mapInstance) return;
    const bounds = mapInstance.getBounds();
    const overpassQuery = `
      [out:json];
      (
        way["highway"]["highway"!~"^(footway|path|cycleway|steps)$"]
          (${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      );
      out body; >; out skel qt;
    `;
    try {
      const response = await fetch(`https://overpass-api.de/api/interpreter`, {
        method: "POST",
        body: overpassQuery,
      });
      if (!response.ok) throw new Error(`OSM fetch failed: ${response.status}`);
      const data = await response.json();
      const osmToGeoJSON = processOSMtoGeoJSON(data);
      if (roadLayers) roadLayers.removeFrom(mapInstance);
      const roadsGeoJSON = L.geoJSON(osmToGeoJSON, {
        style: (feature) => {
          const highway = feature?.properties?.highway;
          if (["motorway", "trunk", "primary"].includes(highway))
            return { color: "#3388ff", weight: 5, opacity: 0.7 };
          if (["secondary", "tertiary"].includes(highway))
            return { color: "#3388ff", weight: 3, opacity: 0.7 };
          return { color: "#777777", weight: 2, opacity: 0.7 };
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties)
            layer.bindTooltip(
              `${feature.properties.name || "Unnamed road"} (${
                feature.properties.highway
              })`
            );
        },
      }).addTo(mapInstance);
      setRoadLayers(roadsGeoJSON);
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

  // **FIX:** Explicitly define the type for the Map's values
  const processOSMtoGeoJSON = (osmData: any): FeatureCollection => {
    const nodes = new Map<number, NodeCoords>(
      osmData.elements
        .filter((el: any) => el.type === "node")
        .map((el: any): [number, NodeCoords] => [
          el.id,
          { lat: el.lat, lon: el.lon },
        ])
    );

    const features: Feature[] = osmData.elements
      .filter((el: any) => el.type === "way" && el.tags?.highway)
      .map((way: any): Feature => {
        const coordinates = way.nodes
          .map((id: number) => {
            const node = nodes.get(id);
            return node ? [node.lon, node.lat] : null;
          })
          .filter(
            (coord: NodeCoords | null): coord is NodeCoords => coord !== null
          );

        return {
          type: "Feature",
          properties: {
            id: way.id,
            ...way.tags,
            name: way.tags.name || `Road-${way.id}`,
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates,
          },
        };
      });
    return { type: "FeatureCollection", features } as FeatureCollection;
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !mapInstance) return;

    setFloodAreaDisplay("Calculating...");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();
      const bbox = image.getBoundingBox();
      const width = image.getWidth();
      const height = image.getHeight();

      let resolution = image.getResolution();
      if (
        !resolution ||
        resolution.length < 2 ||
        (resolution[0] === 0 && resolution[1] === 0)
      ) {
        const xRes = (bbox[2] - bbox[0]) / width;
        const yRes = (bbox[3] - bbox[1]) / height;
        resolution = [xRes, yRes, 0];
      }

      const metadata: ImageMetadata = {
        width,
        height,
        bounds: bbox,
        crs: getCRS(image),
        origin: image.getOrigin(),
        resolution,
        bands: image.getSamplesPerPixel(),
      };
      setImageMetadata(metadata);

      const boundsLatLng: L.LatLngBoundsLiteral = [
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]],
      ];
      const leafletBounds = L.latLngBounds(boundsLatLng);
      setFloodBounds(leafletBounds);

      const rasters = await image.readRasters();
      const bandData = rasters[0];

      if (typeof bandData !== "number") {
        const floodMaskArray = new Uint8Array(
          bandData.map((pixel) => (pixel === 1 ? 1 : 0))
        );
        setFloodPixelData(floodMaskArray);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        const imageData = ctx.createImageData(width, height);
        if (typeof bandData !== "number") {
          for (let i = 0; i < bandData.length; i++) {
            const dataIndex = i * 4;
            if (bandData[i] === 1) {
              imageData.data[dataIndex] = 0;
              imageData.data[dataIndex + 1] = 100;
              imageData.data[dataIndex + 2] = 255;
              imageData.data[dataIndex + 3] = 150;
            } else {
              imageData.data[dataIndex + 3] = 0;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }

        if (imageOverlay) imageOverlay.remove();
        const newOverlay = L.imageOverlay(canvas.toDataURL(), leafletBounds, {
          opacity: 0.7,
        }).addTo(mapInstance);
        setImageOverlay(newOverlay);
        mapInstance.flyToBounds(leafletBounds);
        loadRealRoadData();
        calculateFloodArea(rasters[0], metadata);
      }
    } catch (error) {
      console.error("Error processing GeoTIFF file:", error);
      alert("Failed to process GeoTIFF file. Check console for details.");
      setFloodAreaDisplay("Error");
      if (imageOverlay) imageOverlay.remove();
    }
  };

  const analyzeRoadImpact = (
    roadsLayer: L.GeoJSON,
    floodPxData: Uint8Array,
    floodBds: L.LatLngBounds,
    meta: ImageMetadata
  ) => {
    if (!mapInstance) return;
    const affected: Feature[] = [];
    const near: Feature[] = [];
    roadsLayer.eachLayer((layer: any) => {
      if (layer.feature?.geometry.type === "LineString") {
        let isInFlood = false,
          isNearFlood = false;
        for (const point of layer.getLatLngs()) {
          if (!floodBds.contains(point)) continue;
          const pxX = Math.floor(
            ((point.lng - meta.bounds[0]) / (meta.bounds[2] - meta.bounds[0])) *
              meta.width
          );
          const pxY = Math.floor(
            (1 -
              (point.lat - meta.bounds[1]) /
                (meta.bounds[3] - meta.bounds[1])) *
              meta.height
          );
          if (floodPxData[pxY * meta.width + pxX] === 1) {
            isInFlood = true;
            break;
          }
          const buffer = 5;
          for (let dx = -buffer; dx <= buffer; dx++) {
            for (let dy = -buffer; dy <= buffer; dy++) {
              if (floodPxData[(pxY + dy) * meta.width + (pxX + dx)] === 1) {
                isNearFlood = true;
                break;
              }
            }
            if (isNearFlood) break;
          }
        }
        if (isInFlood) {
          layer.setStyle({ color: "#ff0000", weight: 5, opacity: 0.9 });
          affected.push(layer.feature);
        } else if (isNearFlood) {
          layer.setStyle({ color: "#ff7800", weight: 4, opacity: 0.8 });
          near.push(layer.feature);
        }
      }
    });
    setAffectedRoads(affected);
    setNearFloodRoads(near);
  };

  const calculateFloodArea = (
    bandData: any,
    currentMetadata: ImageMetadata
  ) => {
    if (!currentMetadata) return;

    if (typeof bandData === "number") {
      setFloodAreaDisplay("Cannot calculate (invalid data)");
      return;
    }

    const floodPixelCount = bandData.reduce(
      (count: number, pixel: number) => count + (pixel === 1 ? 1 : 0),
      0
    );

    if (
      currentMetadata.crs.includes("4326") ||
      currentMetadata.crs.includes("Geographic")
    ) {
      const centerLat =
        (currentMetadata.bounds[1] + currentMetadata.bounds[3]) / 2;
      const earthRadius = 6378137; // meters
      const metersPerDegreeLat =
        111132.954 -
        559.822 * Math.cos((2 * centerLat * Math.PI) / 180) +
        1.175 * Math.cos((4 * centerLat * Math.PI) / 180);
      const metersPerDegreeLon =
        (Math.PI / 180) * earthRadius * Math.cos((centerLat * Math.PI) / 180);

      const pixelWidthMeters =
        Math.abs(currentMetadata.resolution[0]) * metersPerDegreeLon;
      const pixelHeightMeters =
        Math.abs(currentMetadata.resolution[1]) * metersPerDegreeLat;

      const pixelAreaM2 = pixelWidthMeters * pixelHeightMeters;
      const totalFloodAreaM2 = floodPixelCount * pixelAreaM2;
      const floodAreaKm2 = totalFloodAreaM2 / 1_000_000;

      setFloodAreaDisplay(`${floodAreaKm2.toFixed(2)} km² (approx.)`);
    } else {
      const pixelAreaM2 = Math.abs(
        currentMetadata.resolution[0] * currentMetadata.resolution[1]
      );
      if (isNaN(pixelAreaM2) || pixelAreaM2 === 0) {
        setFloodAreaDisplay("Error (Invalid Pixel Area)");
        return;
      }
      const totalFloodAreaM2 = floodPixelCount * pixelAreaM2;
      const floodAreaKm2 = totalFloodAreaM2 / 1_000_000;
      setFloodAreaDisplay(`${floodAreaKm2.toFixed(2)} km² (approx.)`);
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
          refreshRoadData={loadRealRoadData}
          imageOverlay={imageOverlay}
          mapInstance={mapInstance}
        />
        <MapComponent setMapInstance={setMapInstance} />
      </div>
    </div>
  );
}

export default App;
