const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'production',
  target: 'node',
  externals: [nodeExternals()],
  
  // Entry points for each handler
  entry: {
    'src/handlers/health': './src/handlers/health.js',
    'src/handlers/auth': './src/handlers/auth.js',
    'src/handlers/cases': './src/handlers/cases.js',
    'src/handlers/upload': './src/handlers/upload.js'
  },
  
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  node: '18'
                }
              }]
            ]
          }
        }
      }
    ]
  },
  
  resolve: {
    extensions: ['.js', '.json'],
    modules: ['node_modules', path.resolve(__dirname, 'src')]
  },
  
  output: {
    path: path.resolve(__dirname, '.webpack/service'),
    filename: '[name].js',
    libraryTarget: 'commonjs2'
  },
  
  optimization: {
    minimize: false // Keep readable for debugging in development
  },
  
  // Avoid bundling AWS SDK v3 (it's available in Lambda runtime)
  externalsPresets: { node: true }
};