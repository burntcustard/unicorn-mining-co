// Format Go source with gofmt and blank lines around brace-delimited blocks.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"strings"
)

func hasBlock(node ast.Node, files *token.FileSet) bool {
	// Clauses share their enclosing switch/select's braces.
	switch node.(type) {
	case *ast.CaseClause, *ast.CommClause:
		return false
	}

	found := false

	ast.Inspect(node, func(child ast.Node) bool {
		if found {
			return false
		}

		switch child.(type) {
		case *ast.BlockStmt, *ast.StructType, *ast.InterfaceType:
			found = true
		case *ast.CompositeLit:
			found = files.PositionFor(child.Pos(), false).Line != files.PositionFor(child.End(), false).Line
		}

		return !found
	})

	return found
}

func separate[T ast.Node](nodes []T, file *ast.File, files *token.FileSet, lines []string, gaps map[int]bool) {
	for index := 1; index < len(nodes); index++ {
		previous, current := nodes[index-1], nodes[index]

		if !hasBlock(previous, files) && !hasBlock(current, files) {
			continue
		}

		end := files.PositionFor(previous.End(), false).Line
		start := files.PositionFor(current.Pos(), false).Line

		// Keep documentation and directives attached to the following block.
		for index := len(file.Comments) - 1; index >= 0; index-- {
			comment := file.Comments[index]
			commentEnd := files.PositionFor(comment.End(), false).Line
			commentStart := files.PositionFor(comment.Pos(), false).Line

			if commentEnd == start-1 && commentStart > end {
				start = commentStart
			}
		}

		if start <= end {
			continue
		}

		blank := false

		for _, line := range lines[end : start-1] {
			if strings.TrimSpace(line) == "" {
				blank = true
				break
			}
		}

		if !blank {
			gaps[start-1] = true
		}
	}
}

func formatSource(source []byte) ([]byte, error) {
	formatted, err := format.Source(source)

	if err != nil {
		return nil, err
	}

	files := token.NewFileSet()
	file, err := parser.ParseFile(files, "", formatted, parser.ParseComments)

	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(formatted), "\n")
	gaps := make(map[int]bool)
	separate(file.Decls, file, files, lines, gaps)

	ast.Inspect(file, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.BlockStmt:
			separate(node.List, file, files, lines, gaps)
		case *ast.CaseClause:
			separate(node.Body, file, files, lines, gaps)
		case *ast.CommClause:
			separate(node.Body, file, files, lines, gaps)
		case *ast.GenDecl:
			separate(node.Specs, file, files, lines, gaps)
		}

		return true
	})

	var spaced strings.Builder

	for index, line := range lines {
		if index > 0 {
			spaced.WriteByte('\n')
		}

		if gaps[index] {
			spaced.WriteByte('\n')
		}

		spaced.WriteString(line)
	}

	// Recompute alignment after splitting groups of compact declarations.
	return format.Source([]byte(spaced.String()))
}

func run() int {
	check := flag.Bool("check", false, "list unformatted files without changing them")
	flag.Parse()
	status := 0

	for _, path := range flag.Args() {
		source, err := os.ReadFile(path)

		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			status = 1
			continue
		}

		formatted, err := formatSource(source)

		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", path, err)
			status = 1
			continue
		}

		if bytes.Equal(source, formatted) {
			continue
		}

		if *check {
			fmt.Println(path)
			status = 1
			continue
		}

		if err := os.WriteFile(path, formatted, 0); err != nil {
			fmt.Fprintln(os.Stderr, err)
			status = 1
		}
	}

	return status
}

func main() {
	os.Exit(run())
}
