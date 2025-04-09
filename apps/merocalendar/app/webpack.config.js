   // webpack.config.js
   module.exports = {
    module: {
      rules: [
        {
          test: /\.module\.scss$/,
          use: [
            'style-loader',
            {
              loader: 'css-loader',
              options: {
                modules: true,
              },
            },
            'sass-loader',
          ],
        },
      ],
    },
  };