const webpack = require('webpack');

module.exports = function override(config) {
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "buffer": require.resolve("buffer/"),
    "stream": require.resolve("stream-browserify"),
    "util": require.resolve("util/"),
    "path": require.resolve("path-browserify")
  };
  
  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    })
  ];
  
  return config;
};

