
export interface ImageMetadata {
  width: number;
  height: number;
  bounds: number[]; // [minX, minY, maxX, maxY]
  crs: string;
  origin: number[];
  resolution: number[];
  bands: number;
}

// Define GeoJSON types to satisfy TypeScript
export type FeatureGeometry = GeoJSON.Geometry;
export type FeatureProperties = GeoJSON.GeoJsonProperties;
export type Feature = GeoJSON.Feature<FeatureGeometry, FeatureProperties>;
export type FeatureCollection = GeoJSON.FeatureCollection<
  FeatureGeometry,
  FeatureProperties
>;