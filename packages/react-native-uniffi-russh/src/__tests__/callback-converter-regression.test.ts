import {
	FfiConverterObjectWithCallbacks,
	FfiConverterUInt64,
	RustBuffer,
} from '@ubjs/core';

test('callback object converter writes plain JS callback handles', () => {
	const callback = { onChange: jest.fn() };
	const converter = new FfiConverterObjectWithCallbacks<typeof callback>({
		bless: jest.fn(),
		unbless: jest.fn(),
		create: jest.fn(),
		pointer: jest.fn(),
		clonePointer: jest.fn(),
		freePointer: jest.fn(),
		isConcreteType: (_obj: unknown): _obj is typeof callback => false,
	});
	const buffer = RustBuffer.withCapacity(8);

	expect(() => converter.write(callback, buffer)).not.toThrow();

	const handle = FfiConverterUInt64.read(buffer);
	expect(handle % 2n).toBe(1n);
	expect(converter.lift(handle)).toBe(callback);
});
