@extends('oms.master')
@section('content')
    <div class="col-md-9 col-sm-9 col-md-push-3 col-sm-push-3">
        <div class="well" style="margin:0 auto;">
            <div class="text-center text-muted">
                <h2>Report Complaint</h2>
            </div>

            @if($errors->any())
                <div class="alert alert-danger">
                    <ul class="list-unstyled">
                        @foreach($errors->all() as $error)
                            <li>{{ $error }}</li>
                        @endforeach
                    </ul>
                </div>
            @endif

            <form method="POST" action="/complaints">
                {{ csrf_field() }}
                <div class="form-group">
                    <label for="title-input">Title</label>
                    <input type="text" id="title-input" name="title" maxlength="150" class="form-control"
                           value="{{ old('title') }}" placeholder="Short summary of the issue">
                </div>
                <div class="row">
                    <div class="form-group col-sm-6">
                        <label for="category">Category</label>
                        <select name="category" class="form-control">
                            @foreach(\App\Oms\Complaint\Models\Complaint::CATEGORIES as $category)
                                <option value="{{ $category }}" {{ old('category') === $category ? 'selected' : '' }}>{{ $category }}</option>
                            @endforeach
                        </select>
                    </div>
                    <div class="form-group col-sm-6">
                        <label for="priority">Priority</label>
                        <select name="priority" class="form-control">
                            @foreach(\App\Oms\Complaint\Models\Complaint::PRIORITIES as $priority)
                                <option value="{{ $priority }}" {{ old('priority', 'Medium') === $priority ? 'selected' : '' }}>{{ $priority }}</option>
                            @endforeach
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="complaint">Details</label>
                    <textarea name="complaint" rows="10" class="form-control"
                              placeholder="Describe your complaint...">{{ old('complaint') }}</textarea>
                </div>
                <button class="btn btn-primary">Submit</button>
                <a href="/complaints" class="btn btn-link">Cancel</a>
            </form>
        </div>
    </div>
    <script>
        document.getElementById('title').innerHTML = "Report Complaint";
    </script>
@stop
