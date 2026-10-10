import React, { useState, useEffect } from 'react';
import { cookApi } from '../services/cookApi';

interface AuthenticatedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  fallback?: React.ReactNode;
}

export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  src,
  alt,
  className,
  fallback,
  ...props
}) => {
  const [blobSrc, setBlobSrc] = useState<string | null>(() => {
    if (src && (src.startsWith('data:') || src.startsWith('blob:'))) {
      return src;
    }
    return null;
  });
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) {
      return;
    }

    let isMounted = true;

    cookApi
      .fetchImageBlob(src)
      .then((resolved) => {
        if (isMounted) {
          setHasError(false);
          setBlobSrc(resolved);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasError(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src]);

  if (!src || hasError) {
    return fallback ? <>{fallback}</> : null;
  }

  if (!blobSrc) {
    return <div className={`animate-pulse bg-stone-200 dark:bg-stone-800 ${className || ''}`} />;
  }

  return (
    <img
      src={blobSrc}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
      {...props}
    />
  );
};
