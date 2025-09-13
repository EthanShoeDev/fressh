import {
	Calculator,
	type BinaryOperator,
	SafeAddition,
	type ComputationResult,
} from '@fressh/react-native-uniffi-russh';

const calculator = new Calculator();

const addOp = new SafeAddition();

class SafeMultiply implements BinaryOperator {
	perform(lhs: bigint, rhs: bigint): bigint {
		return lhs * rhs;
	}
}

const multOp = new SafeMultiply();

// bigints
const three = 3n;
const seven = 7n;

// Perform the calculation, and to get an object
// representing the computation result.
const computation: ComputationResult = calculator
	.calculate(addOp, three, three)
	.calculateMore(multOp, seven)
	.lastResult()!;

// Unpack the bigint value into a string.
export const result = computation.value.toString();
