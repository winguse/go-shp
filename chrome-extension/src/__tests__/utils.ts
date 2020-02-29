import {snakeCaseToCamelCase, camelCaseToSnakeCase} from '../utils';


test('case convert', () => {
    const input = {
        number_key: 1,
        string_key: "str",
        empty_object_key: {},
        empty_array_key: [],
        undefined_key: undefined,
        null_key: null,
        boolean_key: true,
        array_key: [{}, {key: 'value', empty_obj: {}, obj: {key: 'value'} }, [], 1234, false],
        object_key: {
            key: 'value',
            number_key: 1,
            string_key: "str",
            empty_object_key: {},
            empty_array_key: [],
            undefined_key: undefined,
            null_key: null,
            boolean_key: true,
        },
    };
    const camelCase = snakeCaseToCamelCase(input);
    const snakeCase = camelCaseToSnakeCase(camelCase);
    expect(JSON.stringify(snakeCase)).toBe(JSON.stringify(input));
});
