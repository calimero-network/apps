import XCTest
@testable import MeroKit

final class OutputParserTests: XCTestCase {

    private func decode<T: Decodable>(_ output: Any?, as: T.Type) throws -> T {
        let data = try XCTUnwrap(try OutputParser.normalize(output))
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct Point: Codable, Equatable { let x: Int; let y: Int }

    func testNullAndEmptyReturnNil() throws {
        XCTAssertNil(try OutputParser.normalize(nil))
        XCTAssertNil(try OutputParser.normalize(NSNull()))
        XCTAssertNil(try OutputParser.normalize([Any]()))
    }

    func testByteArrayDecodesToJSON() throws {
        // Legacy node: output is the UTF-8 bytes of `{"x":1,"y":2}`.
        let json = #"{"x":1,"y":2}"#
        let bytes = Array(json.utf8).map { Int($0) }
        let point = try decode(bytes, as: Point.self)
        XCTAssertEqual(point, Point(x: 1, y: 2))
    }

    func testParsedObjectReSerializes() throws {
        let obj: [String: Any] = ["x": 3, "y": 4]
        let point = try decode(obj, as: Point.self)
        XCTAssertEqual(point, Point(x: 3, y: 4))
    }

    func testArrayOfObjects() throws {
        let arr: [Any] = [["x": 1, "y": 1], ["x": 2, "y": 2]]
        let points = try decode(arr, as: [Point].self)
        XCTAssertEqual(points.count, 2)
        XCTAssertEqual(points[1], Point(x: 2, y: 2))
    }

    func testStringContainingJSONObject() throws {
        let s = #"{"x":9,"y":8}"#
        let point = try decode(s, as: Point.self)
        XCTAssertEqual(point, Point(x: 9, y: 8))
    }

    func testBareScalarString() throws {
        let value = try decode("hello", as: String.self)
        XCTAssertEqual(value, "hello")
    }

    func testScalarNumber() throws {
        let value = try decode(42, as: Int.self)
        XCTAssertEqual(value, 42)
    }
}
