import React, { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MapProps {
  setMapInstance: (map: L.Map | null) => void;
}

const MapComponent: React.FC<MapProps> = ({ setMapInstance }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if the map container is available
    if (mapContainerRef.current) {
      // Create the map instance
      const map = L.map(mapContainerRef.current).setView(
        [40.7128, -74.006],
        13
      );

      // Add the tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Set the map instance in the parent component
      setMapInstance(map);

      // Return a cleanup function that will run when the component unmounts
      return () => {
        map.remove();
        setMapInstance(null);
      };
    }
    // The dependency array only contains `setMapInstance`, which is a stable function
    // guaranteed by React not to change. This ensures the effect runs only once.
  }, [setMapInstance]);

  return (
    <main className="flex-1 relative">
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
    </main>
  );
};

export default MapComponent;