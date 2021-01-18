'use strict';
var equal = require('ajv/lib/compile/equal');
var validate = (function() {
  var refVal = [];
  var refVal1 = (function() {
    return function validate(data, dataPath, parentData, parentDataProperty, rootData) {
      'use strict';
      var vErrors = null;
      var errors = 0;
      if ((data && typeof data === "object" && !Array.isArray(data))) {
        if (true) {
          var errs__0 = errors;
          var valid1 = true;
          for (var key0 in data) {
            var isAdditional0 = !(false || key0 == 'hosts' || key0 == 'name' || key0 == 'selectPolicy');
            if (isAdditional0) {
              valid1 = false;
              validate.errors = [{
                keyword: 'additionalProperties',
                dataPath: (dataPath || '') + "",
                schemaPath: '#/additionalProperties',
                params: {
                  additionalProperty: '' + key0 + ''
                },
                message: 'should NOT have additional properties'
              }];
              return false;
              break;
            }
          }
          if (valid1) {
            var data1 = data.hosts;
            if (data1 === undefined) {
              valid1 = false;
              validate.errors = [{
                keyword: 'required',
                dataPath: (dataPath || '') + "",
                schemaPath: '#/required',
                params: {
                  missingProperty: 'hosts'
                },
                message: 'should have required property \'hosts\''
              }];
              return false;
            } else {
              var errs_1 = errors;
              if (Array.isArray(data1)) {
                if (data1.length < 1) {
                  validate.errors = [{
                    keyword: 'minItems',
                    dataPath: (dataPath || '') + '.hosts',
                    schemaPath: '#/properties/hosts/minItems',
                    params: {
                      limit: 1
                    },
                    message: 'should NOT have fewer than 1 items'
                  }];
                  return false;
                } else {
                  var errs__1 = errors;
                  var valid1;
                  for (var i1 = 0; i1 < data1.length; i1++) {
                    var errs_2 = errors;
                    if (typeof data1[i1] !== "string") {
                      validate.errors = [{
                        keyword: 'type',
                        dataPath: (dataPath || '') + '.hosts[' + i1 + ']',
                        schemaPath: '#/properties/hosts/items/type',
                        params: {
                          type: 'string'
                        },
                        message: 'should be string'
                      }];
                      return false;
                    }
                    var valid2 = errors === errs_2;
                    if (!valid2) break;
                  }
                }
              } else {
                validate.errors = [{
                  keyword: 'type',
                  dataPath: (dataPath || '') + '.hosts',
                  schemaPath: '#/properties/hosts/type',
                  params: {
                    type: 'array'
                  },
                  message: 'should be array'
                }];
                return false;
              }
              var valid1 = errors === errs_1;
            }
            if (valid1) {
              if (data.name === undefined) {
                valid1 = false;
                validate.errors = [{
                  keyword: 'required',
                  dataPath: (dataPath || '') + "",
                  schemaPath: '#/required',
                  params: {
                    missingProperty: 'name'
                  },
                  message: 'should have required property \'name\''
                }];
                return false;
              } else {
                var errs_1 = errors;
                if (typeof data.name !== "string") {
                  validate.errors = [{
                    keyword: 'type',
                    dataPath: (dataPath || '') + '.name',
                    schemaPath: '#/properties/name/type',
                    params: {
                      type: 'string'
                    },
                    message: 'should be string'
                  }];
                  return false;
                }
                var valid1 = errors === errs_1;
              }
              if (valid1) {
                var data1 = data.selectPolicy;
                if (data1 === undefined) {
                  valid1 = false;
                  validate.errors = [{
                    keyword: 'required',
                    dataPath: (dataPath || '') + "",
                    schemaPath: '#/required',
                    params: {
                      missingProperty: 'selectPolicy'
                    },
                    message: 'should have required property \'selectPolicy\''
                  }];
                  return false;
                } else {
                  var errs_1 = errors;
                  var errs_2 = errors;
                  if (typeof data1 !== "string") {
                    validate.errors = [{
                      keyword: 'type',
                      dataPath: (dataPath || '') + '.selectPolicy',
                      schemaPath: '#/definitions/ProxySelectPolicy/type',
                      params: {
                        type: 'string'
                      },
                      message: 'should be string'
                    }];
                    return false;
                  }
                  var schema2 = refVal2.enum;
                  var valid2;
                  valid2 = false;
                  for (var i2 = 0; i2 < schema2.length; i2++)
                    if (equal(data1, schema2[i2])) {
                      valid2 = true;
                      break;
                    } if (!valid2) {
                    validate.errors = [{
                      keyword: 'enum',
                      dataPath: (dataPath || '') + '.selectPolicy',
                      schemaPath: '#/definitions/ProxySelectPolicy/enum',
                      params: {
                        allowedValues: schema2
                      },
                      message: 'should be equal to one of the allowed values'
                    }];
                    return false;
                  }
                  var valid2 = errors === errs_2;
                  var valid1 = errors === errs_1;
                }
              }
            }
          }
        }
      } else {
        validate.errors = [{
          keyword: 'type',
          dataPath: (dataPath || '') + "",
          schemaPath: '#/type',
          params: {
            type: 'object'
          },
          message: 'should be object'
        }];
        return false;
      }
      validate.errors = vErrors;
      return errors === 0;
    };
  })();
  refVal1.schema = {
    "additionalProperties": false,
    "properties": {
      "hosts": {
        "description": "hosts of this proxy",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "type": "array"
      },
      "name": {
        "type": "string"
      },
      "selectPolicy": {
        "$ref": "#/definitions/ProxySelectPolicy"
      }
    },
    "required": ["hosts", "name", "selectPolicy"],
    "type": "object"
  };
  refVal1.errors = null;
  refVal[1] = refVal1;
  var refVal2 = {
    "enum": ["LATENCY", "RANDOM", "RANDOM_ON_SIMILAR_LOWEST_LATENCY", "VARIANCE"],
    "type": "string"
  };
  refVal[2] = refVal2;
  var refVal3 = {
    "additionalProperties": false,
    "properties": {
      "domains": {
        "description": "domains for this rule",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "type": "array"
      },
      "proxyName": {
        "type": "string"
      }
    },
    "required": ["domains", "proxyName"],
    "type": "object"
  };
  refVal[3] = refVal3;
  var refVal4 = {
    "additionalProperties": false,
    "properties": {
      "detect": {
        "type": "boolean"
      },
      "detectDelayMs": {
        "type": "number"
      },
      "detectExpiresSecond": {
        "type": "number"
      },
      "proxyName": {
        "type": "string"
      }
    },
    "required": ["detect", "detectDelayMs", "detectExpiresSecond", "proxyName"],
    "type": "object"
  };
  refVal[4] = refVal4;
  return function validate(data, dataPath, parentData, parentDataProperty, rootData) {
    'use strict';
    var vErrors = null;
    var errors = 0;
    if (rootData === undefined) rootData = data;
    if ((data && typeof data === "object" && !Array.isArray(data))) {
      if (true) {
        var errs__0 = errors;
        var valid1 = true;
        for (var key0 in data) {
          var isAdditional0 = !(false || key0 == 'authBasePath' || key0 == 'nonCNDomainProxyName' || key0 == 'proxies' || key0 == 'rules' || key0 == 'token' || key0 == 'unmatchedPolicy' || key0 == 'username');
          if (isAdditional0) {
            valid1 = false;
            validate.errors = [{
              keyword: 'additionalProperties',
              dataPath: (dataPath || '') + "",
              schemaPath: '#/additionalProperties',
              params: {
                additionalProperty: '' + key0 + ''
              },
              message: 'should NOT have additional properties'
            }];
            return false;
            break;
          }
        }
        if (valid1) {
          if (data.authBasePath === undefined) {
            valid1 = false;
            validate.errors = [{
              keyword: 'required',
              dataPath: (dataPath || '') + "",
              schemaPath: '#/required',
              params: {
                missingProperty: 'authBasePath'
              },
              message: 'should have required property \'authBasePath\''
            }];
            return false;
          } else {
            var errs_1 = errors;
            if (typeof data.authBasePath !== "string") {
              validate.errors = [{
                keyword: 'type',
                dataPath: (dataPath || '') + '.authBasePath',
                schemaPath: '#/properties/authBasePath/type',
                params: {
                  type: 'string'
                },
                message: 'should be string'
              }];
              return false;
            }
            var valid1 = errors === errs_1;
          }
          if (valid1) {
            if (data.nonCNDomainProxyName === undefined) {
              valid1 = true;
            } else {
              var errs_1 = errors;
              if (typeof data.nonCNDomainProxyName !== "string") {
                validate.errors = [{
                  keyword: 'type',
                  dataPath: (dataPath || '') + '.nonCNDomainProxyName',
                  schemaPath: '#/properties/nonCNDomainProxyName/type',
                  params: {
                    type: 'string'
                  },
                  message: 'should be string'
                }];
                return false;
              }
              var valid1 = errors === errs_1;
            }
            if (valid1) {
              var data1 = data.proxies;
              if (data1 === undefined) {
                valid1 = false;
                validate.errors = [{
                  keyword: 'required',
                  dataPath: (dataPath || '') + "",
                  schemaPath: '#/required',
                  params: {
                    missingProperty: 'proxies'
                  },
                  message: 'should have required property \'proxies\''
                }];
                return false;
              } else {
                var errs_1 = errors;
                if (Array.isArray(data1)) {
                  if (data1.length < 1) {
                    validate.errors = [{
                      keyword: 'minItems',
                      dataPath: (dataPath || '') + '.proxies',
                      schemaPath: '#/properties/proxies/minItems',
                      params: {
                        limit: 1
                      },
                      message: 'should NOT have fewer than 1 items'
                    }];
                    return false;
                  } else {
                    var errs__1 = errors;
                    var valid1;
                    for (var i1 = 0; i1 < data1.length; i1++) {
                      var errs_2 = errors;
                      if (!refVal1(data1[i1], (dataPath || '') + '.proxies[' + i1 + ']', data1, i1, rootData)) {
                        if (vErrors === null) vErrors = refVal1.errors;
                        else vErrors = vErrors.concat(refVal1.errors);
                        errors = vErrors.length;
                      }
                      var valid2 = errors === errs_2;
                      if (!valid2) break;
                    }
                  }
                } else {
                  validate.errors = [{
                    keyword: 'type',
                    dataPath: (dataPath || '') + '.proxies',
                    schemaPath: '#/properties/proxies/type',
                    params: {
                      type: 'array'
                    },
                    message: 'should be array'
                  }];
                  return false;
                }
                var valid1 = errors === errs_1;
              }
              if (valid1) {
                var data1 = data.rules;
                if (data1 === undefined) {
                  valid1 = false;
                  validate.errors = [{
                    keyword: 'required',
                    dataPath: (dataPath || '') + "",
                    schemaPath: '#/required',
                    params: {
                      missingProperty: 'rules'
                    },
                    message: 'should have required property \'rules\''
                  }];
                  return false;
                } else {
                  var errs_1 = errors;
                  if (Array.isArray(data1)) {
                    if (data1.length < 1) {
                      validate.errors = [{
                        keyword: 'minItems',
                        dataPath: (dataPath || '') + '.rules',
                        schemaPath: '#/properties/rules/minItems',
                        params: {
                          limit: 1
                        },
                        message: 'should NOT have fewer than 1 items'
                      }];
                      return false;
                    } else {
                      var errs__1 = errors;
                      var valid1;
                      for (var i1 = 0; i1 < data1.length; i1++) {
                        var data2 = data1[i1];
                        var errs_2 = errors;
                        var errs_3 = errors;
                        if ((data2 && typeof data2 === "object" && !Array.isArray(data2))) {
                          if (true) {
                            var errs__3 = errors;
                            var valid4 = true;
                            for (var key3 in data2) {
                              var isAdditional3 = !(false || key3 == 'domains' || key3 == 'proxyName');
                              if (isAdditional3) {
                                valid4 = false;
                                validate.errors = [{
                                  keyword: 'additionalProperties',
                                  dataPath: (dataPath || '') + '.rules[' + i1 + ']',
                                  schemaPath: '#/definitions/Rule/additionalProperties',
                                  params: {
                                    additionalProperty: '' + key3 + ''
                                  },
                                  message: 'should NOT have additional properties'
                                }];
                                return false;
                                break;
                              }
                            }
                            if (valid4) {
                              var data3 = data2.domains;
                              if (data3 === undefined) {
                                valid4 = false;
                                validate.errors = [{
                                  keyword: 'required',
                                  dataPath: (dataPath || '') + '.rules[' + i1 + ']',
                                  schemaPath: '#/definitions/Rule/required',
                                  params: {
                                    missingProperty: 'domains'
                                  },
                                  message: 'should have required property \'domains\''
                                }];
                                return false;
                              } else {
                                var errs_4 = errors;
                                if (Array.isArray(data3)) {
                                  if (data3.length < 1) {
                                    validate.errors = [{
                                      keyword: 'minItems',
                                      dataPath: (dataPath || '') + '.rules[' + i1 + '].domains',
                                      schemaPath: '#/definitions/Rule/properties/domains/minItems',
                                      params: {
                                        limit: 1
                                      },
                                      message: 'should NOT have fewer than 1 items'
                                    }];
                                    return false;
                                  } else {
                                    var errs__4 = errors;
                                    var valid4;
                                    for (var i4 = 0; i4 < data3.length; i4++) {
                                      var errs_5 = errors;
                                      if (typeof data3[i4] !== "string") {
                                        validate.errors = [{
                                          keyword: 'type',
                                          dataPath: (dataPath || '') + '.rules[' + i1 + '].domains[' + i4 + ']',
                                          schemaPath: '#/definitions/Rule/properties/domains/items/type',
                                          params: {
                                            type: 'string'
                                          },
                                          message: 'should be string'
                                        }];
                                        return false;
                                      }
                                      var valid5 = errors === errs_5;
                                      if (!valid5) break;
                                    }
                                  }
                                } else {
                                  validate.errors = [{
                                    keyword: 'type',
                                    dataPath: (dataPath || '') + '.rules[' + i1 + '].domains',
                                    schemaPath: '#/definitions/Rule/properties/domains/type',
                                    params: {
                                      type: 'array'
                                    },
                                    message: 'should be array'
                                  }];
                                  return false;
                                }
                                var valid4 = errors === errs_4;
                              }
                              if (valid4) {
                                if (data2.proxyName === undefined) {
                                  valid4 = false;
                                  validate.errors = [{
                                    keyword: 'required',
                                    dataPath: (dataPath || '') + '.rules[' + i1 + ']',
                                    schemaPath: '#/definitions/Rule/required',
                                    params: {
                                      missingProperty: 'proxyName'
                                    },
                                    message: 'should have required property \'proxyName\''
                                  }];
                                  return false;
                                } else {
                                  var errs_4 = errors;
                                  if (typeof data2.proxyName !== "string") {
                                    validate.errors = [{
                                      keyword: 'type',
                                      dataPath: (dataPath || '') + '.rules[' + i1 + '].proxyName',
                                      schemaPath: '#/definitions/Rule/properties/proxyName/type',
                                      params: {
                                        type: 'string'
                                      },
                                      message: 'should be string'
                                    }];
                                    return false;
                                  }
                                  var valid4 = errors === errs_4;
                                }
                              }
                            }
                          }
                        } else {
                          validate.errors = [{
                            keyword: 'type',
                            dataPath: (dataPath || '') + '.rules[' + i1 + ']',
                            schemaPath: '#/definitions/Rule/type',
                            params: {
                              type: 'object'
                            },
                            message: 'should be object'
                          }];
                          return false;
                        }
                        var valid3 = errors === errs_3;
                        var valid2 = errors === errs_2;
                        if (!valid2) break;
                      }
                    }
                  } else {
                    validate.errors = [{
                      keyword: 'type',
                      dataPath: (dataPath || '') + '.rules',
                      schemaPath: '#/properties/rules/type',
                      params: {
                        type: 'array'
                      },
                      message: 'should be array'
                    }];
                    return false;
                  }
                  var valid1 = errors === errs_1;
                }
                if (valid1) {
                  if (data.token === undefined) {
                    valid1 = false;
                    validate.errors = [{
                      keyword: 'required',
                      dataPath: (dataPath || '') + "",
                      schemaPath: '#/required',
                      params: {
                        missingProperty: 'token'
                      },
                      message: 'should have required property \'token\''
                    }];
                    return false;
                  } else {
                    var errs_1 = errors;
                    if (typeof data.token !== "string") {
                      validate.errors = [{
                        keyword: 'type',
                        dataPath: (dataPath || '') + '.token',
                        schemaPath: '#/properties/token/type',
                        params: {
                          type: 'string'
                        },
                        message: 'should be string'
                      }];
                      return false;
                    }
                    var valid1 = errors === errs_1;
                  }
                  if (valid1) {
                    var data1 = data.unmatchedPolicy;
                    if (data1 === undefined) {
                      valid1 = true;
                    } else {
                      var errs_1 = errors;
                      var errs_2 = errors;
                      if ((data1 && typeof data1 === "object" && !Array.isArray(data1))) {
                        if (true) {
                          var errs__2 = errors;
                          var valid3 = true;
                          for (var key2 in data1) {
                            var isAdditional2 = !(false || key2 == 'detect' || key2 == 'detectDelayMs' || key2 == 'detectExpiresSecond' || key2 == 'proxyName');
                            if (isAdditional2) {
                              valid3 = false;
                              validate.errors = [{
                                keyword: 'additionalProperties',
                                dataPath: (dataPath || '') + '.unmatchedPolicy',
                                schemaPath: '#/definitions/UnmatchedPolicy/additionalProperties',
                                params: {
                                  additionalProperty: '' + key2 + ''
                                },
                                message: 'should NOT have additional properties'
                              }];
                              return false;
                              break;
                            }
                          }
                          if (valid3) {
                            if (data1.detect === undefined) {
                              valid3 = false;
                              validate.errors = [{
                                keyword: 'required',
                                dataPath: (dataPath || '') + '.unmatchedPolicy',
                                schemaPath: '#/definitions/UnmatchedPolicy/required',
                                params: {
                                  missingProperty: 'detect'
                                },
                                message: 'should have required property \'detect\''
                              }];
                              return false;
                            } else {
                              var errs_3 = errors;
                              if (typeof data1.detect !== "boolean") {
                                validate.errors = [{
                                  keyword: 'type',
                                  dataPath: (dataPath || '') + '.unmatchedPolicy.detect',
                                  schemaPath: '#/definitions/UnmatchedPolicy/properties/detect/type',
                                  params: {
                                    type: 'boolean'
                                  },
                                  message: 'should be boolean'
                                }];
                                return false;
                              }
                              var valid3 = errors === errs_3;
                            }
                            if (valid3) {
                              if (data1.detectDelayMs === undefined) {
                                valid3 = false;
                                validate.errors = [{
                                  keyword: 'required',
                                  dataPath: (dataPath || '') + '.unmatchedPolicy',
                                  schemaPath: '#/definitions/UnmatchedPolicy/required',
                                  params: {
                                    missingProperty: 'detectDelayMs'
                                  },
                                  message: 'should have required property \'detectDelayMs\''
                                }];
                                return false;
                              } else {
                                var errs_3 = errors;
                                if (typeof data1.detectDelayMs !== "number") {
                                  validate.errors = [{
                                    keyword: 'type',
                                    dataPath: (dataPath || '') + '.unmatchedPolicy.detectDelayMs',
                                    schemaPath: '#/definitions/UnmatchedPolicy/properties/detectDelayMs/type',
                                    params: {
                                      type: 'number'
                                    },
                                    message: 'should be number'
                                  }];
                                  return false;
                                }
                                var valid3 = errors === errs_3;
                              }
                              if (valid3) {
                                if (data1.detectExpiresSecond === undefined) {
                                  valid3 = false;
                                  validate.errors = [{
                                    keyword: 'required',
                                    dataPath: (dataPath || '') + '.unmatchedPolicy',
                                    schemaPath: '#/definitions/UnmatchedPolicy/required',
                                    params: {
                                      missingProperty: 'detectExpiresSecond'
                                    },
                                    message: 'should have required property \'detectExpiresSecond\''
                                  }];
                                  return false;
                                } else {
                                  var errs_3 = errors;
                                  if (typeof data1.detectExpiresSecond !== "number") {
                                    validate.errors = [{
                                      keyword: 'type',
                                      dataPath: (dataPath || '') + '.unmatchedPolicy.detectExpiresSecond',
                                      schemaPath: '#/definitions/UnmatchedPolicy/properties/detectExpiresSecond/type',
                                      params: {
                                        type: 'number'
                                      },
                                      message: 'should be number'
                                    }];
                                    return false;
                                  }
                                  var valid3 = errors === errs_3;
                                }
                                if (valid3) {
                                  if (data1.proxyName === undefined) {
                                    valid3 = false;
                                    validate.errors = [{
                                      keyword: 'required',
                                      dataPath: (dataPath || '') + '.unmatchedPolicy',
                                      schemaPath: '#/definitions/UnmatchedPolicy/required',
                                      params: {
                                        missingProperty: 'proxyName'
                                      },
                                      message: 'should have required property \'proxyName\''
                                    }];
                                    return false;
                                  } else {
                                    var errs_3 = errors;
                                    if (typeof data1.proxyName !== "string") {
                                      validate.errors = [{
                                        keyword: 'type',
                                        dataPath: (dataPath || '') + '.unmatchedPolicy.proxyName',
                                        schemaPath: '#/definitions/UnmatchedPolicy/properties/proxyName/type',
                                        params: {
                                          type: 'string'
                                        },
                                        message: 'should be string'
                                      }];
                                      return false;
                                    }
                                    var valid3 = errors === errs_3;
                                  }
                                }
                              }
                            }
                          }
                        }
                      } else {
                        validate.errors = [{
                          keyword: 'type',
                          dataPath: (dataPath || '') + '.unmatchedPolicy',
                          schemaPath: '#/definitions/UnmatchedPolicy/type',
                          params: {
                            type: 'object'
                          },
                          message: 'should be object'
                        }];
                        return false;
                      }
                      var valid2 = errors === errs_2;
                      var valid1 = errors === errs_1;
                    }
                    if (valid1) {
                      if (data.username === undefined) {
                        valid1 = false;
                        validate.errors = [{
                          keyword: 'required',
                          dataPath: (dataPath || '') + "",
                          schemaPath: '#/required',
                          params: {
                            missingProperty: 'username'
                          },
                          message: 'should have required property \'username\''
                        }];
                        return false;
                      } else {
                        var errs_1 = errors;
                        if (typeof data.username !== "string") {
                          validate.errors = [{
                            keyword: 'type',
                            dataPath: (dataPath || '') + '.username',
                            schemaPath: '#/properties/username/type',
                            params: {
                              type: 'string'
                            },
                            message: 'should be string'
                          }];
                          return false;
                        }
                        var valid1 = errors === errs_1;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate.errors = [{
        keyword: 'type',
        dataPath: (dataPath || '') + "",
        schemaPath: '#/type',
        params: {
          type: 'object'
        },
        message: 'should be object'
      }];
      return false;
    }
    validate.errors = vErrors;
    return errors === 0;
  };
})();
validate.schema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": false,
  "definitions": {
    "Proxy": {
      "additionalProperties": false,
      "properties": {
        "hosts": {
          "description": "hosts of this proxy",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "type": "array"
        },
        "name": {
          "type": "string"
        },
        "selectPolicy": {
          "$ref": "#/definitions/ProxySelectPolicy"
        }
      },
      "required": ["hosts", "name", "selectPolicy"],
      "type": "object"
    },
    "ProxySelectPolicy": {
      "enum": ["LATENCY", "RANDOM", "RANDOM_ON_SIMILAR_LOWEST_LATENCY", "VARIANCE"],
      "type": "string"
    },
    "Rule": {
      "additionalProperties": false,
      "properties": {
        "domains": {
          "description": "domains for this rule",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "type": "array"
        },
        "proxyName": {
          "type": "string"
        }
      },
      "required": ["domains", "proxyName"],
      "type": "object"
    },
    "UnmatchedPolicy": {
      "additionalProperties": false,
      "properties": {
        "detect": {
          "type": "boolean"
        },
        "detectDelayMs": {
          "type": "number"
        },
        "detectExpiresSecond": {
          "type": "number"
        },
        "proxyName": {
          "type": "string"
        }
      },
      "required": ["detect", "detectDelayMs", "detectExpiresSecond", "proxyName"],
      "type": "object"
    }
  },
  "description": "SHP config",
  "properties": {
    "authBasePath": {
      "type": "string"
    },
    "nonCNDomainProxyName": {
      "description": "If this set to non-empty, will enable the detect logic of CN/non-CN domains:\n1. query the DNS for each requested domain with EDNS source IP\n2. if the A record hit CN IPs DIRECT\n    else the selected proxy name",
      "type": "string"
    },
    "proxies": {
      "description": "Proxies",
      "items": {
        "$ref": "#/definitions/Proxy"
      },
      "minItems": 1,
      "type": "array"
    },
    "rules": {
      "description": "Rules",
      "items": {
        "$ref": "#/definitions/Rule"
      },
      "minItems": 1,
      "type": "array"
    },
    "token": {
      "type": "string"
    },
    "unmatchedPolicy": {
      "$ref": "#/definitions/UnmatchedPolicy"
    },
    "username": {
      "type": "string"
    }
  },
  "required": ["authBasePath", "proxies", "rules", "token", "username"],
  "type": "object"
};
validate.errors = null;
module.exports = validate;