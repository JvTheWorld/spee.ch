const Path = require('path');
const nodeExternals = require('webpack-node-externals');
const REACT_ROOT = Path.resolve(__dirname, 'react/');

module.exports = {
  target: 'node',
  node  : {
    __dirname: false,
  },
  externals: [nodeExternals()],
  entry    : ['babel-polyfill', 'whatwg-fetch', './index.js'],
  output   : {
    path      : Path.join(__dirname, '/'),
    publicPath: '/',
    filename  : 'server.js',
  },
  module: {
    rules: [
      {
        test   : /.jsx?$/,
        exclude: /node_modules/,
        loader : 'babel-loader',
        options: {
          presets: ['es2015',  'react', 'stage-2'],
        },
      },
      {
        test  : /.css$/,
        loader: 'css-loader',
      },
    ],
  },
  resolve: {
    modules: [
      REACT_ROOT,
      'node_modules',
      __dirname,
    ],
    extensions: ['.js', '.json', '.jsx', '.css'],
  },
};
