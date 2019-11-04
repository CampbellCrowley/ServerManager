module.exports = {
  'extends': [
    'eslint:recommended',
    'google',
  ],
  'env': {
    'node': true,
    'es6': true,
  },
  'parserOptions': {
    'ecmaFeatures': {'modules': true},
    'ecmaVersion': 2018,
  },
  'rules': {
    'no-console': 'off',
    'no-constant-condition': [
      'error',
      {
        'checkLoops': false,
      },
    ],
    'no-multi-spaces': [
      'error',
      {
        'ignoreEOLComments': true,
      },
    ],
    'indent': [
      'error',
      2,
      {
        'CallExpression': {'arguments': 2},
        'FunctionDeclaration': {'body': 1, 'parameters': 2},
        'FunctionExpression': {'body': 1, 'parameters': 2},
        'MemberExpression': 2,
        'ObjectExpression': 1,
        'SwitchCase': 1,
        'ignoredNodes': ['ConditionalExpression'],
      },
    ],
    'valid-jsdoc': [
      'warn',
      {
        'requireReturn': false,
        'requireReturnType': true,
        'requireParamDescription': true,
        'requireReturnDescription': true,
        'requireParamType': true,
      },
    ],
  },
};
